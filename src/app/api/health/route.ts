import { NextResponse } from "next/server";
import { pingRedis } from "@/core/queue";
import { services } from "@/web/services";

export const dynamic = "force-dynamic";

// Readiness probe: reports whether the two stateful dependencies answer. Details stay in
// the logs so the endpoint can be exposed to a load balancer.
export async function GET() {
  const { db, redis, logger } = services();
  const [database, queue] = await Promise.allSettled([db.$queryRaw`SELECT 1`, pingRedis(redis)]);
  for (const [dependency, result] of [
    ["database", database],
    ["redis", queue],
  ] as const) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason as unknown, dependency }, "Health check failed");
    }
  }
  const checks = { database: database.status === "fulfilled", redis: queue.status === "fulfilled" };
  const healthy = checks.database && checks.redis;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", ...checks },
    { status: healthy ? 200 : 503 },
  );
}
