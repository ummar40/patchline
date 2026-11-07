import { transitionJob } from "@/core/jobs/service";
import { InvalidTransitionError, TERMINAL_STATUSES } from "@/core/jobs/state-machine";
import type { Logger } from "@/core/logging/logger";
import { type JobQueue, dispatchJob } from "@/core/queue";
import type { Database } from "@/db";

const DISPATCH_GRACE_MS = 15_000;
const STUCK_GRACE_MS = 120_000;

// Keeps PostgreSQL (the source of truth) and the queue (dispatch only) consistent:
//  - a QUEUED row with no live queue entry is dispatched again, which covers a Redis outage
//    at creation time or a lost queue;
//  - a row that claims to be running while the queue has no active entry for it lost its
//    worker without the worker being able to say so, and is marked as interrupted.
export async function reconcileJobs(
  deps: { db: Database; queue: JobQueue; logger: Logger },
  isRunningHere: (jobId: string) => boolean,
  now = new Date(),
): Promise<{ dispatched: string[]; interrupted: string[] }> {
  const dispatched: string[] = [];
  const interrupted: string[] = [];

  const queued = await deps.db.maintenanceJob.findMany({
    where: { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - DISPATCH_GRACE_MS) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const { id } of queued) {
    const entry = await deps.queue.getJob(id);
    const state = entry ? await entry.getState() : "missing";
    if (state === "failed" || state === "completed") {
      await entry?.remove();
    }
    if (state === "missing" || state === "failed" || state === "completed") {
      await dispatchJob(deps.queue, id);
      dispatched.push(id);
    }
  }

  const running = await deps.db.maintenanceJob.findMany({
    where: {
      status: { notIn: ["QUEUED", ...TERMINAL_STATUSES] },
      updatedAt: { lt: new Date(now.getTime() - STUCK_GRACE_MS) },
    },
    select: { id: true },
    take: 100,
  });
  for (const { id } of running) {
    if (isRunningHere(id)) {
      continue;
    }
    const entry = await deps.queue.getJob(id);
    const state = entry ? await entry.getState() : "missing";
    if (state === "active" || state === "waiting" || state === "prioritized") {
      continue;
    }
    try {
      await transitionJob(deps.db, {
        jobId: id,
        to: "FAILED",
        errorCategory: "WORKER_INTERRUPTED",
        outcomeSummary:
          "The worker running this job disappeared without reporting a result. Nothing was pushed. Create a follow-up job to run it again.",
        message: "Job stopped: no worker is running it",
      });
      interrupted.push(id);
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) {
        throw error;
      }
    }
  }

  if (dispatched.length > 0 || interrupted.length > 0) {
    deps.logger.warn({ dispatched, interrupted }, "Reconciler repaired job state");
  }
  return { dispatched, interrupted };
}
