import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createLogger } from "@/core/logging/logger";
import { createJobQueue, createWorkerConnection, dispatchJob } from "@/core/queue";
import { reconcileJobs } from "@/worker/reconciler";
import { connectTestDatabase, resetDatabase } from "./support/database";
import {
  installationView,
  queueJob,
  repositoryByName,
  repositoryView,
  signIn,
} from "./support/factories";

const redisUrl = inject("redisUrl");
const db = connectTestDatabase();
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!redisUrl)("job reconciler", () => {
  // A private queue name keeps the test away from a development worker on the same Redis.
  const connection = createWorkerConnection(redisUrl);
  const queue = createJobQueue(`test-reconciler-${randomBytes(4).toString("hex")}`, connection);
  const later = (seconds: number) => new Date(Date.now() + seconds * 1_000);
  const nobodyRunsIt = () => false;

  beforeEach(async () => {
    await resetDatabase(db);
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
    await db.$disconnect();
  });

  async function seedJob() {
    const { user } = await signIn(db, "alice", [
      installationView("acme", [repositoryView("acme/api")]),
    ]);
    return queueJob(db, user.id, (await repositoryByName(db, "acme/api")).id);
  }

  it("dispatches a queued job that never reached the queue", async () => {
    const job = await seedJob();
    expect(await queue.getJob(job.id)).toBeUndefined();

    const result = await reconcileJobs({ db, queue, logger }, nobodyRunsIt, later(60));

    expect(result.dispatched).toEqual([job.id]);
    expect((await queue.getJob(job.id))?.data).toEqual({ jobId: job.id });
  });

  it("leaves freshly created and already dispatched jobs alone", async () => {
    const job = await seedJob();
    expect((await reconcileJobs({ db, queue, logger }, nobodyRunsIt)).dispatched).toEqual([]);

    await dispatchJob(queue, job.id);
    expect(
      (await reconcileJobs({ db, queue, logger }, nobodyRunsIt, later(60))).dispatched,
    ).toEqual([]);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("marks a job as interrupted when it claims to be running but no worker has it", async () => {
    const job = await seedJob();
    await db.maintenanceJob.update({ where: { id: job.id }, data: { status: "IMPLEMENTING" } });

    const result = await reconcileJobs({ db, queue, logger }, nobodyRunsIt, later(600));

    expect(result.interrupted).toEqual([job.id]);
    expect(await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      errorCategory: "WORKER_INTERRUPTED",
    });
  });

  it("does not touch a job this worker is running, or one that only just changed", async () => {
    const job = await seedJob();
    await db.maintenanceJob.update({ where: { id: job.id }, data: { status: "VERIFYING" } });

    expect(
      (await reconcileJobs({ db, queue, logger }, (id) => id === job.id, later(600))).interrupted,
    ).toEqual([]);
    expect((await reconcileJobs({ db, queue, logger }, nobodyRunsIt)).interrupted).toEqual([]);
    expect((await db.maintenanceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "VERIFYING",
    );
  });
});
