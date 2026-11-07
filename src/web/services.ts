import "server-only";
import type { Redis } from "ioredis";
import { type WebConfig, loadWebConfig } from "@/core/config";
import { type GitHubApp, createGitHubApp } from "@/core/github/app";
import { type Logger, createLogger } from "@/core/logging/logger";
import { type JobQueue, createJobQueue, createProducerConnection } from "@/core/queue";
import { type Database, createDatabase } from "@/db";

type Services = {
  config: WebConfig;
  logger: Logger;
  db: Database;
  github: GitHubApp;
  redis: Redis;
  queue: JobQueue;
};

// Cached on globalThis so development hot reloads reuse the connection pools instead of
// leaking one per reload.
const store = globalThis as typeof globalThis & { patchlineServices?: Services };

function build(): Services {
  const config = loadWebConfig();
  const logger = createLogger({ service: "web", level: config.logLevel });

  const redis = createProducerConnection(config.redis.url);
  redis.on("error", (error) => logger.warn({ err: error }, "Redis connection error"));

  return {
    config,
    logger,
    db: createDatabase(config.database.url),
    github: createGitHubApp(config.github),
    redis,
    queue: createJobQueue(config.queue.name, redis),
  };
}

export function services(): Services {
  store.patchlineServices ??= build();
  return store.patchlineServices;
}
