import type { CommandSource, JobStatus } from "@/db/generated/enums";
import { type NetworkMode, REPOSITORY_DIR, type Sandbox } from "../sandbox/types";
import type { JobRecorder } from "./recorder";

export type ShellCommandRequest = {
  command: string;
  source: CommandSource;
  phase: JobStatus;
  purpose?: string;
  network?: NetworkMode;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ShellCommandResult = {
  commandId: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
  truncated: boolean;
  startedAt: Date;
};

// Runs a shell command line inside the sandbox and records it. The string is interpreted by
// bash inside the container; the host only ever sees it as one opaque argument.
export async function runShellCommand(
  sandbox: Sandbox,
  recorder: JobRecorder,
  request: ShellCommandRequest,
): Promise<ShellCommandResult> {
  const startedAt = new Date();
  const result = await sandbox.exec({
    // Merging stderr into stdout inside the container keeps the output in the order a
    // developer would see it in a terminal.
    argv: ["bash", "-c", `exec 2>&1\n${request.command}`],
    workdir: REPOSITORY_DIR,
    network: request.network ?? "none",
    timeoutMs: request.timeoutMs,
    signal: request.signal,
  });
  const output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
  const commandId = await recorder.command({
    source: request.source,
    phase: request.phase,
    command: request.command,
    purpose: request.purpose,
    networkEnabled: request.network === "egress",
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    output,
    outputTruncated: result.truncated,
    startedAt,
  });
  return {
    commandId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    output,
    truncated: result.truncated,
    startedAt,
  };
}
