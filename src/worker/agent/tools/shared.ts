import type { z } from "zod";
import type { Analysis, Implementation, Plan, Reproduction, Review } from "@/core/jobs/artifacts";
import type { JobStatus } from "@/db/generated/enums";
import type { JobRecorder } from "../../pipeline/recorder";
import { REPOSITORY_DIR, type Sandbox } from "../../sandbox/types";
import type { ToolSpec } from "../model/types";

export const FILE_TOOL_TIMEOUT_MS = 60_000;
export const MAX_READ_BYTES = 1_048_576;
export const MAX_WRITE_BYTES = 524_288;
export const MAX_LINES_PER_READ = 400;

export type Submission =
  | { kind: "analysis"; value: Analysis }
  | { kind: "reproduction"; value: Reproduction }
  | { kind: "plan"; value: Plan }
  | { kind: "implementation"; value: Implementation }
  | { kind: "review"; value: Review }
  | { kind: "human"; value: { reason: string } };

export type ToolOutcome = {
  output: string;
  failed?: boolean;
  submission?: Submission;
  // True when the call changed the working copy, which resets repeat detection.
  mutated?: boolean;
  // Stable identity of the result for repeat detection, when the output itself contains
  // values that differ on every call (ids, timings).
  fingerprint?: string;
};

export type ToolContext = {
  sandbox: Sandbox;
  recorder: JobRecorder;
  phase: JobStatus;
  baseCommitSha: string;
  maxOutputChars: number;
  commandTimeoutMs: number;
  signal: AbortSignal;
};

export type AgentTool<Schema extends z.ZodType = z.ZodType> = {
  spec: ToolSpec & { parameters: Schema };
  execute(args: z.output<Schema>, context: ToolContext): Promise<ToolOutcome>;
};

// Erases the schema type so tools with different parameters can share one registry. The
// registry re-validates arguments against each tool's own schema before calling execute.
export function defineTool<Schema extends z.ZodType>(tool: AgentTool<Schema>): AgentTool {
  return tool as unknown as AgentTool;
}

export const failure = (message: string): ToolOutcome => ({
  output: `ERROR: ${message}`,
  failed: true,
});

export function shorten(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const head = Math.floor(maxChars / 3);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n[... ${text.length - maxChars} characters omitted ...]\n${text.slice(-tail)}`;
}

export async function readRepositoryFile(
  context: ToolContext,
  path: string,
): Promise<{ content: string; oversized: boolean } | { error: string }> {
  const result = await context.sandbox.exec({
    argv: ["head", "-c", String(MAX_READ_BYTES + 1), "--", `${REPOSITORY_DIR}/${path}`],
    timeoutMs: FILE_TOOL_TIMEOUT_MS,
    maxOutputBytes: MAX_READ_BYTES * 2,
    rawOutput: true,
    signal: context.signal,
  });
  if (result.exitCode !== 0) {
    return { error: result.stderr.trim() || `could not read ${path}` };
  }
  if (result.stdout.includes("\u0000") || result.stdout.includes("\uFFFD")) {
    return { error: `${path} is a binary file` };
  }
  return { content: result.stdout, oversized: Buffer.byteLength(result.stdout) > MAX_READ_BYTES };
}

export async function writeRepositoryFile(
  context: ToolContext,
  path: string,
  content: string,
): Promise<string | undefined> {
  const result = await context.sandbox.exec({
    argv: [
      "sh",
      "-c",
      'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"',
      "sh",
      `${REPOSITORY_DIR}/${path}`,
    ],
    stdin: content,
    timeoutMs: FILE_TOOL_TIMEOUT_MS,
    signal: context.signal,
  });
  return result.exitCode === 0 ? undefined : result.stderr.trim() || `could not write ${path}`;
}
