import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ActiveJobLimitError,
  JobNotFoundError,
  createJob,
  recordEvent,
  requestCancellation,
  transitionJob,
} from "@/core/jobs/service";
import { InvalidTransitionError } from "@/core/jobs/state-machine";
import { REDACTED } from "@/core/logging/redaction";
import type { Database } from "@/db";
import { connectTestDatabase, resetDatabase } from "./support/database";
import {
  installationView,
  queueJob,
  repositoryByName,
  repositoryView,
  signIn,
} from "./support/factories";

const db = connectTestDatabase();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

async function seedJob(database: Database) {
  const { user } = await signIn(database, "alice", [
    installationView("acme", [repositoryView("acme/api")]),
  ]);
  const repository = await repositoryByName(database, "acme/api");
  return { user, repository, job: await queueJob(database, user.id, repository.id) };
}

async function advance(jobId: string, ...statuses: Parameters<typeof transitionJob>[1]["to"][]) {
  for (const to of statuses) {
    await transitionJob(db, { jobId, to });
  }
}

describe("job creation", () => {
  it("persists the job as QUEUED together with its first event", async () => {
    const { job } = await seedJob(db);
    expect(job.status).toBe("QUEUED");
    const events = await db.jobEvent.findMany({ where: { jobId: job.id } });
    expect(events.map((event) => event.type)).toEqual(["JOB_CREATED"]);
  });

  it("enforces the per-user active job limit and frees it when jobs finish", async () => {
    const { user, repository, job } = await seedJob(db);
    const create = () =>
      createJob(db, {
        repositoryId: repository.id,
        createdById: user.id,
        baseBranch: "main",
        title: "Another job",
        problemDescription: "A second problem that needs fixing soon.",
        reproductionSteps: undefined,
        expectedBehavior: undefined,
        maxActiveJobsPerUser: 1,
      });

    await expect(create()).rejects.toBeInstanceOf(ActiveJobLimitError);
    await transitionJob(db, {
      jobId: job.id,
      to: "FAILED",
      errorCategory: "INTERNAL",
      outcomeSummary: "stopped",
    });
    await expect(create()).resolves.toMatchObject({ status: "QUEUED" });
  });
});

describe("transitionJob", () => {
  it("persists status, timestamps and a STATE_CHANGED event", async () => {
    const { job } = await seedJob(db);
    const previous = await transitionJob(db, {
      jobId: job.id,
      to: "PREPARING",
      message: "Worker picked up the job",
    });

    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    const events = await db.jobEvent.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } });
    expect(previous).toBe("QUEUED");
    expect(stored.status).toBe("PREPARING");
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.finishedAt).toBeNull();
    expect(events.at(-1)).toMatchObject({
      type: "STATE_CHANGED",
      fromStatus: "QUEUED",
      toStatus: "PREPARING",
      message: "Worker picked up the job",
    });
  });

  it("rejects an illegal transition and leaves the job untouched", async () => {
    const { job } = await seedJob(db);
    await expect(transitionJob(db, { jobId: job.id, to: "VERIFYING" })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );

    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("QUEUED");
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: "STATE_CHANGED" } })).toBe(0);
  });

  it("records the outcome when a job reaches a terminal status", async () => {
    const { job } = await seedJob(db);
    await advance(job.id, "PREPARING", "CLONING");
    await transitionJob(db, {
      jobId: job.id,
      to: "NEEDS_HUMAN",
      errorCategory: "VERIFICATION_FAILED",
      outcomeSummary: "Tests still fail after 3 repair iterations.",
    });

    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored).toMatchObject({
      status: "NEEDS_HUMAN",
      errorCategory: "VERIFICATION_FAILED",
      outcomeSummary: "Tests still fail after 3 repair iterations.",
    });
    expect(stored.finishedAt).toBeInstanceOf(Date);
    await expect(transitionJob(db, { jobId: job.id, to: "IMPLEMENTING" })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("lets only one of several workers claim a queued job", async () => {
    const { job } = await seedJob(db);
    const claims = await Promise.allSettled(
      Array.from({ length: 6 }, () => transitionJob(db, { jobId: job.id, to: "PREPARING" })),
    );

    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    for (const claim of claims) {
      if (claim.status === "rejected") {
        expect(claim.reason).toBeInstanceOf(InvalidTransitionError);
      }
    }
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: "STATE_CHANGED" } })).toBe(1);
  });

  it("lets only one of two conflicting outcomes win", async () => {
    const { job } = await seedJob(db);
    await advance(
      job.id,
      "PREPARING",
      "CLONING",
      "ANALYZING",
      "REPRODUCING",
      "PLANNING",
      "IMPLEMENTING",
      "VERIFYING",
      "REVIEWING",
      "CREATING_PR",
    );

    const outcomes = await Promise.allSettled([
      transitionJob(db, { jobId: job.id, to: "COMPLETED" }),
      transitionJob(db, { jobId: job.id, to: "NEEDS_HUMAN", errorCategory: "PUBLISH_FAILED" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    const lastEvent = await db.jobEvent.findFirstOrThrow({
      where: { jobId: job.id },
      orderBy: { id: "desc" },
    });
    expect(lastEvent.toStatus).toBe(stored.status);
  });

  it("fails for a job that does not exist", async () => {
    await expect(transitionJob(db, { jobId: "missing", to: "PREPARING" })).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
  });
});

describe("requestCancellation", () => {
  it("cancels a queued job immediately", async () => {
    const { job, user } = await seedJob(db);
    expect(await requestCancellation(db, { jobId: job.id, userId: user.id })).toBe("CANCELLED");

    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored).toMatchObject({ status: "CANCELLED", cancelRequestedById: user.id });
    expect(stored.finishedAt).toBeInstanceOf(Date);
  });

  it("flags a running job for the worker instead of changing its status", async () => {
    const { job, user } = await seedJob(db);
    await advance(job.id, "PREPARING", "CLONING", "ANALYZING");

    expect(await requestCancellation(db, { jobId: job.id, userId: user.id })).toBe("REQUESTED");
    expect(await requestCancellation(db, { jobId: job.id, userId: user.id })).toBe(
      "ALREADY_REQUESTED",
    );

    const stored = await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("ANALYZING");
    expect(stored.cancelRequestedAt).toBeInstanceOf(Date);
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: "CANCEL_REQUESTED" } })).toBe(1);
  });

  it("refuses once publishing has started or the job is finished", async () => {
    const { job, user } = await seedJob(db);
    await advance(
      job.id,
      "PREPARING",
      "CLONING",
      "ANALYZING",
      "REPRODUCING",
      "PLANNING",
      "IMPLEMENTING",
      "VERIFYING",
      "REVIEWING",
      "CREATING_PR",
    );
    expect(await requestCancellation(db, { jobId: job.id, userId: user.id })).toBe(
      "NOT_CANCELLABLE",
    );

    await advance(job.id, "COMPLETED");
    expect(await requestCancellation(db, { jobId: job.id, userId: user.id })).toBe(
      "NOT_CANCELLABLE",
    );
    expect(
      (await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } })).cancelRequestedAt,
    ).toBeNull();
  });
});

describe("recordEvent", () => {
  it("redacts secrets from messages and structured data before they are stored", async () => {
    const { job } = await seedJob(db);
    const token = `ghs_${"k".repeat(36)}`;
    await recordEvent(db, {
      jobId: job.id,
      type: "COMMAND",
      message: `git clone https://x-access-token:${token}@github.com/acme/api.git`,
      data: { stderr: `fatal: ${token}`, installationToken: token, exitCode: 128 },
    });

    const event = await db.jobEvent.findFirstOrThrow({ where: { jobId: job.id, type: "COMMAND" } });
    expect(JSON.stringify([event.message, event.data])).not.toContain(token);
    expect(event.data).toMatchObject({ installationToken: REDACTED, exitCode: 128 });
  });
});
