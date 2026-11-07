import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
    // Empty when no sandbox image is configured; Docker-backed suites skip themselves then.
    sandboxImage: string;
    // Empty when Redis is not configured; queue-backed suites skip themselves then.
    redisUrl: string;
  }
}

// Database-backed suites run against a dedicated database next to the development one, so
// they exercise real constraints and transactions without touching development data.
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Set DATABASE_URL (or TEST_DATABASE_URL) before running tests. See .env.example.",
    );
  }
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

async function ensureDatabaseExists(target: string): Promise<void> {
  const url = new URL(target);
  const name = url.pathname.slice(1);
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("The test database name may only contain letters, digits and underscores.");
  }
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable. Start it with "npm run infra:up". (${(error as Error).message})`,
    );
  }
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile(".env");
  }
  const url = testDatabaseUrl();
  await ensureDatabaseExists(url);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  project.provide("testDatabaseUrl", url);
  project.provide("sandboxImage", process.env.SANDBOX_IMAGE ?? "");
  project.provide("redisUrl", process.env.REDIS_URL ?? "");
}
