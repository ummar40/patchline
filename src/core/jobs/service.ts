import type { Database, Prisma } from "@/db";
import type { EventLevel, JobErrorCategory, JobEventType, JobStatus } from "@/db/generated/enums";
import { redactText, redactValue } from "../logging/redaction";
import type { JobInput } from "./input";
import {
  InvalidTransitionError,
  TERMINAL_STATUSES,
  canTransition,
  isCancellable,
  isTerminal,
} from "./state-machine";

type DatabaseOrTransaction = Database | Prisma.TransactionClient;

export class JobNotFoundError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} does not exist`);
    this.name = "JobNotFoundError";
  }
}

export class ActiveJobLimitError extends Error {
  constructor(readonly limit: number) {
    super(`The limit of ${limit} active jobs has been reached`);
    this.name = "ActiveJobLimitError";
  }
}

export type JobEventInput = {
  jobId: string;
  type: JobEventType;
  message: string;
  level?: EventLevel;
  fromStatus?: JobStatus;
  toStatus?: JobStatus;
  data?: Record<string, unknown>;
};

export async function recordEvent(db: DatabaseOrTransaction, input: JobEventInput): Promise<void> {
  await db.jobEvent.create({
    data: {
      jobId: input.jobId,
      type: input.type,
      level: input.level ?? "INFO",
      message: redactText(input.message),
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      data: input.data ? (redactValue(input.data) as Prisma.InputJsonObject) : undefined,
    },
  });
}

export type CreateJobInput = JobInput & {
  repositoryId: string;
  createdById: string;
  baseBranch: string;
  retryOfJobId?: string;
  maxActiveJobsPerUser: number;
};

export async function createJob(db: Database, input: CreateJobInput) {
  return db.$transaction(async (tx) => {
    const active = await tx.maintenanceJob.count({
      where: { createdById: input.createdById, status: { notIn: [...TERMINAL_STATUSES] } },
    });
    if (active >= input.maxActiveJobsPerUser) {
      throw new ActiveJobLimitError(input.maxActiveJobsPerUser);
    }
    const job = await tx.maintenanceJob.create({
      data: {
        repositoryId: input.repositoryId,
        createdById: input.createdById,
        retryOfJobId: input.retryOfJobId,
        title: input.title,
        problemDescription: input.problemDescription,
        reproductionSteps: input.reproductionSteps,
        expectedBehavior: input.expectedBehavior,
        baseBranch: input.baseBranch,
      },
    });
    await recordEvent(tx, {
      jobId: job.id,
      type: "JOB_CREATED",
      message: "Job created and queued",
      toStatus: "QUEUED",
    });
    return job;
  });
}

export type TransitionInput = {
  jobId: string;
  to: JobStatus;
  message?: string;
  level?: EventLevel;
  data?: Record<string, unknown>;
  errorCategory?: JobErrorCategory;
  outcomeSummary?: string;
  patch?: Pick<
    Prisma.MaintenanceJobUncheckedUpdateManyInput,
    "baseCommitSha" | "workBranch" | "cancelRequestedAt" | "cancelRequestedById"
  >;
};

// Compare-and-set on the current status. If another writer moved the job first, the update
// matches no row and the transition is rejected instead of overwriting their state.
export async function transitionJob(db: Database, input: TransitionInput): Promise<JobStatus> {
  return db.$transaction(async (tx) => {
    const current = await tx.maintenanceJob.findUnique({
      where: { id: input.jobId },
      select: { status: true },
    });
    if (!current) {
      throw new JobNotFoundError(input.jobId);
    }
    if (!canTransition(current.status, input.to)) {
      throw new InvalidTransitionError(current.status, input.to);
    }

    const now = new Date();
    const { count } = await tx.maintenanceJob.updateMany({
      where: { id: input.jobId, status: current.status },
      data: {
        ...input.patch,
        status: input.to,
        startedAt: current.status === "QUEUED" && !isTerminal(input.to) ? now : undefined,
        finishedAt: isTerminal(input.to) ? now : undefined,
        errorCategory: input.errorCategory,
        outcomeSummary: input.outcomeSummary ? redactText(input.outcomeSummary) : undefined,
      },
    });
    if (count !== 1) {
      const latest = await tx.maintenanceJob.findUnique({
        where: { id: input.jobId },
        select: { status: true },
      });
      throw new InvalidTransitionError(latest?.status ?? current.status, input.to);
    }

    await recordEvent(tx, {
      jobId: input.jobId,
      type: "STATE_CHANGED",
      level: input.level ?? (input.to === "FAILED" ? "ERROR" : "INFO"),
      message: input.message ?? `Status changed to ${input.to}`,
      fromStatus: current.status,
      toStatus: input.to,
      data: {
        ...input.data,
        ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
      },
    });
    return current.status;
  });
}

export type CancellationOutcome =
  "CANCELLED" | "REQUESTED" | "ALREADY_REQUESTED" | "NOT_CANCELLABLE";

export async function requestCancellation(
  db: Database,
  input: { jobId: string; userId: string },
): Promise<CancellationOutcome> {
  const job = await db.maintenanceJob.findUnique({
    where: { id: input.jobId },
    select: { status: true },
  });
  if (!job) {
    throw new JobNotFoundError(input.jobId);
  }
  if (!isCancellable(job.status)) {
    return "NOT_CANCELLABLE";
  }

  const now = new Date();
  if (job.status === "QUEUED") {
    try {
      await transitionJob(db, {
        jobId: input.jobId,
        to: "CANCELLED",
        message: "Cancelled before a worker started the job",
        outcomeSummary: "Cancelled by a user before work started.",
        data: { requestedById: input.userId },
        patch: { cancelRequestedAt: now, cancelRequestedById: input.userId },
      });
      return "CANCELLED";
    } catch (error) {
      // A worker claimed the job between the read and the write. Fall through and ask
      // that worker to stop.
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
    }
  }

  return db.$transaction(async (tx) => {
    const { count } = await tx.maintenanceJob.updateMany({
      where: {
        id: input.jobId,
        cancelRequestedAt: null,
        status: { notIn: [...TERMINAL_STATUSES, "CREATING_PR"] },
      },
      data: { cancelRequestedAt: now, cancelRequestedById: input.userId },
    });
    if (count === 0) {
      const latest = await tx.maintenanceJob.findUnique({
        where: { id: input.jobId },
        select: { status: true, cancelRequestedAt: true },
      });
      return latest && isCancellable(latest.status) && latest.cancelRequestedAt
        ? "ALREADY_REQUESTED"
        : "NOT_CANCELLABLE";
    }
    await recordEvent(tx, {
      jobId: input.jobId,
      type: "CANCEL_REQUESTED",
      level: "WARN",
      message: "Cancellation requested",
      data: { requestedById: input.userId },
    });
    return "REQUESTED";
  });
}
