import { Worker } from "bullmq";
import { ConfigError, loadWorkerConfig } from "@/core/config";
import { createGitHubApp } from "@/core/github/app";
import { isTerminal } from "@/core/jobs/state-machine";
import { createLogger } from "@/core/logging/logger";
import {
  type JobPayload,
  createJobQueue,
  createProducerConnection,
  createWorkerConnection,
  jobPayloadSchema,
} from "@/core/queue";
import { createDatabase } from "@/db";
import { OpenAIModelProvider } from "./agent/model/openai-provider";
import { createGitHubGateway } from "./pipeline/github-gateway";
import { type PipelineDeps, runJob } from "./pipeline/run-job";
import { reconcileJobs } from "./reconciler";
import { DockerSandboxProvider } from "./sandbox/docker-sandbox";

const LOCK_DURATION_MS = 60_000;
const CLEANUP_GRACE_MS = 300_000;

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = createLogger({ service: "worker", level: config.logLevel });
  const db = createDatabase(config.database.url);
  const sandboxes = new DockerSandboxProvider(config.sandbox);

  await sandboxes.assertReady();
  await db.$queryRaw`SELECT 1`;

  const deps: PipelineDeps = {
    config,
    db,
    logger,
    sandboxes,
    github: createGitHubGateway(createGitHubApp(config.github)),
    model: new OpenAIModelProvider(config.model),
  };

  const shutdown = new AbortController();
  const active = new Set<string>();

  // Reclaims workspaces whose job can no longer be using them: the worker died before its
  // own cleanup ran. A recently finished job is left alone because its worker may still be
  // capturing the final state of the working copy.
  const sweepSandboxes = async () => {
    const removed = await sandboxes.removeOrphans(async (jobId) => {
      if (active.has(jobId)) {
        return true;
      }
      const job = await db.maintenanceJob.findUnique({
        where: { id: jobId },
        select: { status: true, finishedAt: true },
      });
      if (!job) {
        return false;
      }
      if (!isTerminal(job.status)) {
        return job.status !== "QUEUED";
      }
      return job.finishedAt !== null && Date.now() - job.finishedAt.getTime() < CLEANUP_GRACE_MS;
    });
    if (removed.length > 0) {
      logger.warn({ jobIds: removed }, "Removed sandbox resources left behind by a worker");
    }
  };
  await sweepSandboxes();

  const producerConnection = createProducerConnection(config.redis.url);
  const workerConnection = createWorkerConnection(config.redis.url);
  for (const connection of [producerConnection, workerConnection]) {
    connection.on("error", (error) => logger.warn({ err: error }, "Redis connection error"));
  }
  const queue = createJobQueue(config.queue.name, producerConnection);

  const worker = new Worker<JobPayload>(
    config.queue.name,
    async (queued) => {
      const { jobId } = jobPayloadSchema.parse(queued.data);
      active.add(jobId);
      try {
        await runJob(deps, jobId, shutdown.signal);
      } finally {
        active.delete(jobId);
      }
    },
    {
      connection: workerConnection,
      concurrency: config.worker.concurrency,
      lockDuration: LOCK_DURATION_MS,
      maxStalledCount: 1,
    },
  );
  worker.on("failed", (queued, error) =>
    logger.error({ err: error, jobId: queued?.data.jobId }, "Queue job failed"),
  );
  worker.on("error", (error) => logger.error({ err: error }, "Queue worker error"));

  const reconcile = () =>
    reconcileJobs({ db, queue, logger }, (jobId) => active.has(jobId))
      .then(sweepSandboxes)
      .catch((error: unknown) => logger.error({ err: error }, "Reconciler failed"));
  const reconcileTimer = setInterval(() => void reconcile(), config.worker.reconcileIntervalMs);
  void reconcile();

  logger.info(
    {
      queue: config.queue.name,
      concurrency: config.worker.concurrency,
      model: config.model.id,
      image: config.sandbox.image,
    },
    "Worker started",
  );

  let stopping = false;
  const stop = async (signalName: string) => {
    if (stopping) {
      logger.warn("Second shutdown signal received; exiting immediately");
      process.exit(1);
    }
    stopping = true;
    logger.info({ signal: signalName, activeJobs: [...active] }, "Shutting down");
    clearInterval(reconcileTimer);

    // Stop taking work, give running jobs a grace period, then interrupt them. An
    // interrupted job is marked FAILED with a clear reason and its sandbox is removed.
    const closing = worker.close();
    const grace = setTimeout(() => shutdown.abort(), config.worker.shutdownGraceMs);
    await closing;
    clearTimeout(grace);

    await queue.close();
    producerConnection.disconnect();
    workerConnection.disconnect();
    await db.$disconnect();
    logger.info("Worker stopped");
    process.exit(0);
  };
  for (const signalName of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signalName, () => void stop(signalName));
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error("Worker failed to start:", error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
