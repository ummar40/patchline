import { spawn } from "node:child_process";
import { BoundedBuffer } from "./output";
import { SandboxError } from "./types";

// The container runtime CLI is the only process the worker ever starts. It receives an
// environment built from this allow-list, so worker secrets (model API key, database and
// Redis URLs) are absent even if a caller mistakenly asks to forward them by name.
const CLI_ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "SystemRoot",
  "PROGRAMDATA",
  "ProgramData",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
];

const KILL_GRACE_MS = 10_000;

export type CliResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};

export type CliOptions = {
  binary: string;
  args: readonly string[];
  stdin?: string;
  extraEnv?: Readonly<Record<string, string>>;
  maxOutputBytes: number;
  rawOutput?: boolean;
};

function cliEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CLI_ENVIRONMENT_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return { ...env, ...extra };
}

export type RunningCli = {
  result: Promise<CliResult>;
  terminate: () => void;
};

export function startCli(options: CliOptions): RunningCli {
  const startedAt = Date.now();
  const stdout = new BoundedBuffer(options.maxOutputBytes);
  const stderr = new BoundedBuffer(options.maxOutputBytes);

  const child = spawn(options.binary, [...options.args], {
    // The cast is needed because the web framework's typings declare NODE_ENV as required.
    env: cliEnvironment(options.extraEnv) as NodeJS.ProcessEnv,
    shell: false,
    windowsHide: true,
    stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  let forcedKill: NodeJS.Timeout | undefined;

  const result = new Promise<CliResult>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.once("error", (error) => {
      clearTimeout(forcedKill);
      reject(
        new SandboxError(`Could not start ${options.binary}: ${error.message}`, { cause: error }),
      );
    });
    child.once("close", (exitCode) => {
      clearTimeout(forcedKill);
      resolve({
        exitCode,
        stdout: stdout.toString(options.rawOutput),
        stderr: stderr.toString(),
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });

  if (options.stdin !== undefined && child.stdin) {
    // The container may exit before reading everything; that surfaces through the exit code.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin);
  }

  return {
    result,
    terminate: () => {
      child.kill();
      forcedKill ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      forcedKill.unref();
    },
  };
}

export async function runCli(options: CliOptions & { timeoutMs: number }): Promise<CliResult> {
  const running = startCli(options);
  const timer = setTimeout(running.terminate, options.timeoutMs);
  try {
    return await running.result;
  } finally {
    clearTimeout(timer);
  }
}
