"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findAccessibleJob, findAccessibleRepository } from "@/core/access";
import { getUserRepositoryPermission } from "@/core/github/app";
import { jobInputSchema } from "@/core/jobs/input";
import { ActiveJobLimitError, createJob, requestCancellation } from "@/core/jobs/service";
import { dispatchJob } from "@/core/queue";
import { githubLogin, requireUser } from "../auth/current-user";
import { jobActionErrorCopy } from "../copy";
import { services } from "../services";

export type JobFormState = {
  message?: string;
  fieldErrors?: Partial<Record<"repositoryId" | keyof z.input<typeof jobInputSchema>, string>>;
  values?: Record<string, string>;
};

const formSchema = jobInputSchema.extend({
  repositoryId: z.string().min(1, "Choose a repository"),
  retryOfJobId: z.string().min(1).optional(),
});

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) {
      values[key] = value;
    }
  }
  return values;
}

export async function createJobAction(
  _previous: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  const user = await requireUser();
  const { config, db, github, queue, logger } = services();
  const values = formValues(formData);

  const parsed = formSchema.safeParse({
    ...values,
    retryOfJobId: values.retryOfJobId || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: JobFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof NonNullable<JobFormState["fieldErrors"]>;
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values };
  }
  const { repositoryId, retryOfJobId, ...input } = parsed.data;

  const repository = await findAccessibleRepository(db, user.id, repositoryId);
  if (!repository) {
    return { message: jobActionErrorCopy.repositoryUnavailable, values };
  }
  if (repository.isArchived) {
    return { message: jobActionErrorCopy.repositoryArchived, values };
  }
  if (repository.installation.suspendedAt) {
    return { message: jobActionErrorCopy.installationSuspended, values };
  }

  // Stored access rows are only as fresh as the user's last sign-in. Before acting on the
  // user's behalf, GitHub is asked directly whether they can currently push.
  const login = githubLogin(user);
  try {
    const permission = login
      ? await getUserRepositoryPermission(
          github,
          {
            installationId: repository.installation.githubInstallationId,
            owner: repository.ownerLogin,
            name: repository.name,
          },
          login,
        )
      : "none";
    if (permission !== "admin" && permission !== "write") {
      return { message: jobActionErrorCopy.writeAccessRequired, values };
    }
  } catch (error) {
    logger.warn(
      { err: error, repositoryId },
      "Could not confirm repository permission with GitHub",
    );
    return { message: jobActionErrorCopy.accessCheckFailed, values };
  }

  const retryOf = retryOfJobId ? await findAccessibleJob(db, user.id, retryOfJobId) : null;

  let jobId: string;
  try {
    const job = await createJob(db, {
      ...input,
      repositoryId: repository.id,
      createdById: user.id,
      baseBranch: repository.defaultBranch,
      retryOfJobId: retryOf?.repositoryId === repository.id ? retryOf.id : undefined,
      maxActiveJobsPerUser: config.limits.maxActiveJobsPerUser,
    });
    jobId = job.id;
  } catch (error) {
    if (error instanceof ActiveJobLimitError) {
      return { message: jobActionErrorCopy.activeJobLimit(error.limit), values };
    }
    throw error;
  }

  try {
    await dispatchJob(queue, jobId);
  } catch (error) {
    // The row is durable; the worker's reconciler dispatches queued jobs it cannot find in
    // the queue, so a Redis outage delays the job instead of losing it.
    logger.error({ err: error, jobId }, "Could not enqueue job; leaving it for the reconciler");
  }

  logger.info({ jobId, repositoryId: repository.id, userId: user.id }, "Maintenance job created");
  redirect(`/jobs/${jobId}`);
}

export async function cancelJobAction(jobId: string): Promise<void> {
  const user = await requireUser();
  const { db, queue, logger } = services();

  const job = await findAccessibleJob(db, user.id, jobId);
  if (!job) {
    return;
  }
  const outcome = await requestCancellation(db, { jobId: job.id, userId: user.id });
  if (outcome === "CANCELLED") {
    await queue.remove(job.id).catch((error: unknown) => {
      logger.warn({ err: error, jobId: job.id }, "Could not remove cancelled job from the queue");
    });
  }
  logger.info({ jobId: job.id, userId: user.id, outcome }, "Job cancellation handled");
  revalidatePath(`/jobs/${job.id}`);
}
