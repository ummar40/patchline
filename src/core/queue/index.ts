import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

// The payload carries only the job id. Everything else is read from PostgreSQL, which is
// the source of truth; Redis is dispatch only.
export const jobPayloadSchema = z.object({ jobId: z.string().min(1) });
export type JobPayload = z.output<typeof jobPayloadSchema>;

export type JobQueue = Queue<JobPayload>;

const DISPATCH_JOB_NAME = "maintenance-job";
const COMPLETED_RETENTION_SECONDS = 3_600;
const FAILED_RETENTION_SECONDS = 86_400;

// Producers fail fast when Redis is unreachable. The job row already exists at that point
// and the worker's reconciler dispatches it later.
export function createProducerConnection(url: string): Redis {
  return new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
}

// BullMQ workers block on Redis and require unlimited per-request retries.
export function createWorkerConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createJobQueue(name: string, connection: Redis): JobQueue {
  return new Queue<JobPayload>(name, {
    connection,
    defaultJobOptions: {
      // A run is costly and publishes to GitHub, so it is never retried automatically.
      attempts: 1,
      removeOnComplete: { age: COMPLETED_RETENTION_SECONDS },
      removeOnFail: { age: FAILED_RETENTION_SECONDS },
    },
  });
}

// A producer connection rejects commands until it is connected, so a probe that arrives
// during start-up waits briefly for the connection instead of reporting a false outage.
export async function pingRedis(connection: Redis, timeoutMs = 2_000): Promise<void> {
  if (connection.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        connection.off("ready", onReady);
        reject(new Error(`Redis connection is ${connection.status}`));
      }, timeoutMs);
      connection.once("ready", onReady);
    });
  }
  await connection.ping();
}

// Using the database id as the queue id makes dispatch idempotent while the entry exists.
export async function dispatchJob(queue: JobQueue, jobId: string): Promise<void> {
  await queue.waitUntilReady();
  await queue.add(DISPATCH_JOB_NAME, { jobId }, { jobId });
}
