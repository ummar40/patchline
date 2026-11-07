import type { VerificationCommands } from "@/core/jobs/artifacts";
import type {
  JobStatus,
  VerificationCategory,
  VerificationStage,
  VerificationStatus,
} from "@/db/generated/enums";
import { shorten } from "../agent/tools";
import { runShellCommand } from "../pipeline/commands";
import type { JobRecorder } from "../pipeline/recorder";
import type { Sandbox } from "../sandbox/types";

const ORDER: { category: VerificationCategory; key: keyof VerificationCommands }[] = [
  { category: "TEST", key: "test" },
  { category: "LINT", key: "lint" },
  { category: "TYPECHECK", key: "typecheck" },
  { category: "BUILD", key: "build" },
];

const COMMAND_NOT_RUNNABLE = new Set([126, 127]);
const FAILURE_EXCERPT_CHARS = 6_000;

export type VerificationResult = {
  category: VerificationCategory;
  command: string;
  status: VerificationStatus;
  exitCode: number | null;
  output: string;
};

function statusOf(result: { exitCode: number | null; timedOut: boolean }): VerificationStatus {
  if (result.timedOut) {
    return "TIMED_OUT";
  }
  if (result.exitCode === 0) {
    return "PASSED";
  }
  return result.exitCode !== null && COMMAND_NOT_RUNNABLE.has(result.exitCode)
    ? "ERRORED"
    : "FAILED";
}

// Verification is executed by the platform, never by the model, and every category runs
// even if an earlier one fails, so the recorded evidence is complete.
export async function runVerification(
  sandbox: Sandbox,
  recorder: JobRecorder,
  options: {
    commands: VerificationCommands;
    stage: VerificationStage;
    iteration: number;
    phase: JobStatus;
    timeoutMs: number;
    signal: AbortSignal;
  },
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const { category, key } of ORDER) {
    const command = options.commands[key];
    if (!command) {
      continue;
    }
    const execution = await runShellCommand(sandbox, recorder, {
      command,
      source: "VERIFICATION",
      phase: options.phase,
      purpose: `${options.stage === "BASELINE" ? "Baseline" : "Post-change"} ${category.toLowerCase()} run`,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const status = statusOf(execution);
    await recorder.verification({
      commandExecutionId: execution.commandId,
      stage: options.stage,
      iteration: options.iteration,
      category,
      command,
      status,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      startedAt: execution.startedAt,
    });
    results.push({
      category,
      command,
      status,
      exitCode: execution.exitCode,
      output: execution.output,
    });
  }
  return results;
}

export function describeResults(results: readonly VerificationResult[]): string {
  return results.length === 0
    ? "No verification commands are available."
    : results
        .map(
          (result) =>
            `${result.category}: ${result.status} (\`${result.command}\`, exit ${result.exitCode ?? "none"})`,
        )
        .join("\n");
}

export function describeFailures(
  results: readonly VerificationResult[],
  categories: readonly VerificationCategory[],
): string {
  return results
    .filter((result) => categories.includes(result.category))
    .map(
      (result) =>
        `${result.category} ${result.status}: \`${result.command}\` (exit ${result.exitCode ?? "none"})\n${shorten(result.output, FAILURE_EXCERPT_CHARS)}`,
    )
    .join("\n\n");
}
