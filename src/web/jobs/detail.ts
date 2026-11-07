import "server-only";
import type { z } from "zod";
import {
  analysisSchema,
  detectionSchema,
  implementationSchema,
  planSchema,
  reproductionSchema,
  reviewSchema,
} from "@/core/jobs/artifacts";
import type { Database } from "@/db";
import type { ArtifactKind } from "@/db/generated/enums";

function parseArtifact<Schema extends z.ZodType>(schema: Schema, content: string | undefined) {
  if (content === undefined) {
    return undefined;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(content));
    return parsed.success ? (parsed.data as z.output<Schema>) : undefined;
  } catch {
    return undefined;
  }
}

// Callers must already have established that the user may see this job.
export async function loadJobEvidence(db: Database, jobId: string) {
  const [events, commands, verificationRuns, artifacts, usageByPhase] = await Promise.all([
    db.jobEvent.findMany({ where: { jobId }, orderBy: { id: "asc" } }),
    db.commandExecution.findMany({ where: { jobId }, orderBy: { startedAt: "asc" } }),
    db.verificationRun.findMany({
      where: { jobId },
      orderBy: { startedAt: "asc" },
      include: { commandExecution: { select: { output: true, outputTruncated: true } } },
    }),
    db.jobArtifact.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } }),
    db.modelInvocation.groupBy({
      by: ["phase"],
      where: { jobId },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        durationMs: true,
        retryCount: true,
        estimatedCostUsd: true,
      },
    }),
  ]);

  const latest = new Map<ArtifactKind, string>();
  for (const artifact of artifacts) {
    latest.set(artifact.kind, artifact.content);
  }

  return {
    events,
    commands,
    verificationRuns,
    usageByPhase,
    patch: latest.get("DIFF"),
    reviewCount: artifacts.filter((artifact) => artifact.kind === "REVIEW").length,
    detection: parseArtifact(detectionSchema, latest.get("DETECTION")),
    analysis: parseArtifact(analysisSchema, latest.get("ANALYSIS")),
    reproduction: parseArtifact(reproductionSchema, latest.get("REPRODUCTION")),
    plan: parseArtifact(planSchema, latest.get("PLAN")),
    implementation: parseArtifact(implementationSchema, latest.get("IMPLEMENTATION")),
    review: parseArtifact(reviewSchema, latest.get("REVIEW")),
  };
}

export type JobEvidence = Awaited<ReturnType<typeof loadJobEvidence>>;
