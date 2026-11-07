export type NetworkMode = "none" | "egress";

// "workspace" is where repository code lives and runs. "publish" is a separate volume that
// repository code never executes in; it is used to build and push the final commit.
export type MountProfile = "workspace" | "publish";

export type ExecRequest = {
  // Executed directly as the container's process. Never interpreted by a host shell.
  argv: readonly string[];
  timeoutMs: number;
  profile?: MountProfile;
  workdir?: string;
  network?: NetworkMode;
  stdin?: string;
  env?: Readonly<Record<string, string>>;
  // Forwarded to the container by name so the values never appear in a process argument list.
  secretEnv?: Readonly<Record<string, string>>;
  maxOutputBytes?: number;
  // Skips terminal-oriented clean-up of stdout, for reading exact file contents.
  rawOutput?: boolean;
  signal?: AbortSignal;
};

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
};

export interface Sandbox {
  readonly jobId: string;
  exec(request: ExecRequest): Promise<ExecResult>;
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  assertReady(): Promise<void>;
  create(jobId: string): Promise<Sandbox>;
  removeOrphans(isActive: (jobId: string) => Promise<boolean>): Promise<string[]>;
}

export class SandboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxError";
  }
}

export const WORKSPACE_ROOT = "/workspace";
export const REPOSITORY_DIR = "/workspace/repo";
export const SANDBOX_HOME = "/home/sandbox";
