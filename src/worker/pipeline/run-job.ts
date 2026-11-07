import { transitionJob } from "@/core/jobs/service";
import { InvalidTransitionError, isTerminal } from "@/core/jobs/state-machine";
import type { Logger } from "@/core/logging/logger";
import type { Database } from "@/db";
import { phaseInstruction, taskMessage } from "../agent/prompts";
import { captureChangeSet } from "../git/operations";
import { describeResults, runVerification } from "../verification/run";
import { describeOutcome } from "./conclude";
import { type PipelineDeps, RunContext, loadJob } from "./context";
import { implementUntilAccepted } from "./implement";
import {
  JobCancelledError,
  JobTimeoutError,
  NeedsHumanError,
  WorkerShutdownError,
} from "./outcomes";
import { discardIncidentalChanges, prepareWorkspace } from "./prepare";
import { publishChange } from "./publish";

export type { PipelineDeps } from "./context";

const CANCEL_POLL_INTERVAL_MS = 2_000;
const CLEANUP_TIMEOUT_MS = 60_000;

// The platform, not the model, drives the phase sequence. Each step either returns what the
// next one needs or throws one of the outcome errors.
async function execute(run: RunContext, stopCancellationWatch: () => void): Promise<void> {
  const { config } = run.deps;
  const { job } = run;
  const { remoteUrl, detection } = await prepareWorkspace(run);

  const session = run.createSession("work");
  session.addTask(
    taskMessage({
      repository: job.repository.fullName,
      baseBranch: job.baseBranch,
      baseCommitSha: run.baseCommitSha,
      title: job.title,
      problemDescription: job.problemDescription,
      reproductionSteps: job.reproductionSteps,
      expectedBehavior: job.expectedBehavior,
      detection,
    }),
  );
  session.addInstruction(phaseInstruction("ANALYZING"));
  const analysis = await session.runPhase("ANALYZING", "analysis");
  await run.recorder.jsonArtifact("ANALYSIS", "analysis.json", analysis);
  if (Object.values(analysis.commands).every((command) => command === null)) {
    throw new NeedsHumanError(
      "NO_VERIFICATION",
      "No test, lint, type check or build command could be identified in this repository, so a change could not be verified. No change was attempted.",
    );
  }

  const baseline = await runVerification(run.sandbox, run.recorder, {
    commands: analysis.commands,
    stage: "BASELINE",
    iteration: 0,
    phase: "ANALYZING",
    timeoutMs: config.sandbox.commandTimeoutMs,
    signal: run.signal,
  });
  await discardIncidentalChanges(run);

  await run.enter("REPRODUCING", "Attempting to reproduce the problem");
  session.addInstruction(
    phaseInstruction(
      "REPRODUCING",
      `Baseline verification, run by the platform before any change:\n${describeResults(baseline)}`,
    ),
  );
  const reproduction = await session.runPhase("REPRODUCING", "reproduction");
  await run.recorder.jsonArtifact("REPRODUCTION", "reproduction.json", reproduction);

  await run.enter("PLANNING", "Planning the change");
  session.addInstruction(phaseInstruction("PLANNING"));
  const plan = await session.runPhase("PLANNING", "plan");
  await run.recorder.jsonArtifact("PLAN", "plan.json", plan);

  const accepted = await implementUntilAccepted(run, session, {
    analysis,
    reproduction,
    plan,
    baseline,
  });
  await publishChange(run, {
    ...accepted,
    remoteUrl,
    reproduction,
    plan,
    baseline,
    stopCancellationWatch,
  });
}

async function conclude(run: RunContext, error: unknown): Promise<void> {
  const outcome = describeOutcome(run.signal.aborted ? run.signal.reason : error, run.status);
  if (outcome.unexpected) {
    run.logger.error({ err: error }, "Unexpected pipeline error");
  }
  // FAILED is reachable from every non-terminal status, so it is the fallback when the
  // preferred outcome is not a legal transition from wherever the job stopped.
  const targets =
    outcome.status === "FAILED" ? (["FAILED"] as const) : ([outcome.status, "FAILED"] as const);
  for (const target of targets) {
    try {
      await transitionJob(run.deps.db, {
        jobId: run.job.id,
        to: target,
        errorCategory: target === "CANCELLED" ? undefined : (outcome.category ?? "INTERNAL"),
        outcomeSummary: outcome.summary,
        message:
          target === "CANCELLED"
            ? "Job cancelled"
            : `Job stopped: ${outcome.summary.split("\n")[0]}`,
        level: target === "FAILED" ? "ERROR" : "WARN",
      });
      return;
    } catch (transitionError) {
      if (!(transitionError instanceof InvalidTransitionError)) {
        throw transitionError;
      }
    }
  }
  run.logger.warn({ status: run.status }, "Job had already reached a terminal status");
}

async function cleanup(run: RunContext): Promise<void> {
  run.forgetTokens();
  if (!run.hasSandbox) {
    return;
  }
  if (run.hasClone && run.status !== "COMPLETED" && run.status !== "CREATING_PR") {
    // Keep whatever work exists so a person can pick it up from the job page.
    await captureChangeSet(run.sandbox, run.baseCommitSha, AbortSignal.timeout(CLEANUP_TIMEOUT_MS))
      .then((changes) => run.storePatch(changes))
      .catch((error: unknown) =>
        run.logger.warn({ err: error }, "Could not capture the final working copy state"),
      );
  }
  await run.sandbox
    .destroy()
    .then(() => run.recorder.event("OPERATION", "Sandbox removed", { operation: "Remove sandbox" }))
    .catch((error: unknown) =>
      run.logger.error({ err: error }, "Sandbox cleanup failed; the orphan sweep will retry"),
    );
}

function watchCancellation(
  db: Database,
  jobId: string,
  controller: AbortController,
  logger: Logger,
): () => void {
  let stopped = false;
  const check = async () => {
    const row = await db.maintenanceJob.findUnique({
      where: { id: jobId },
      select: { cancelRequestedAt: true },
    });
    // A query that was already in flight when the watch was stopped must not abort the job.
    if (row?.cancelRequestedAt && !stopped) {
      controller.abort(new JobCancelledError());
    }
  };
  const timer = setInterval(() => {
    check().catch((error: unknown) =>
      logger.warn({ err: error, jobId }, "Cancellation check failed"),
    );
  }, CANCEL_POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// Entry point for one dispatched job. Job-level failures are recorded on the job and do not
// throw; only an inability to record anything at all propagates to the queue.
export async function runJob(
  deps: PipelineDeps,
  jobId: string,
  shutdownSignal: AbortSignal,
): Promise<void> {
  const job = await loadJob(deps.db, jobId);
  if (!job) {
    deps.logger.warn({ jobId }, "Dispatched job does not exist");
    return;
  }
  if (job.status !== "QUEUED") {
    if (!isTerminal(job.status)) {
      // The queue redelivers a job whose worker died. The partial run is not resumed.
      await transitionJob(deps.db, {
        jobId,
        to: "FAILED",
        errorCategory: "WORKER_INTERRUPTED",
        outcomeSummary:
          "A worker stopped unexpectedly while this job was running. Nothing was pushed. Create a follow-up job to run it again.",
        message: "Job stopped: worker was interrupted",
      });
    }
    return;
  }

  try {
    await transitionJob(deps.db, { jobId, to: "PREPARING", message: "A worker picked up the job" });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      deps.logger.info({ jobId }, "Job was cancelled or claimed before this worker could start it");
      return;
    }
    throw error;
  }

  const controller = new AbortController();
  const onShutdown = () => controller.abort(new WorkerShutdownError());
  if (shutdownSignal.aborted) {
    onShutdown();
  }
  shutdownSignal.addEventListener("abort", onShutdown, { once: true });
  const limitMs = deps.config.agent.jobTimeoutMs;
  const deadline = setTimeout(() => controller.abort(new JobTimeoutError(limitMs)), limitMs);
  const stopWatch = watchCancellation(deps.db, jobId, controller, deps.logger);

  const run = new RunContext(deps, job, controller.signal);
  try {
    await execute(run, stopWatch);
  } catch (error) {
    await conclude(run, error);
  } finally {
    clearTimeout(deadline);
    stopWatch();
    shutdownSignal.removeEventListener("abort", onShutdown);
    await cleanup(run);
  }
}
