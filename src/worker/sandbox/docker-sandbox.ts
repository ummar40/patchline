import { randomBytes } from "node:crypto";
import { runCli, startCli } from "./docker-cli";
import {
  type ExecRequest,
  type ExecResult,
  REPOSITORY_DIR,
  SANDBOX_HOME,
  type Sandbox,
  SandboxError,
  type SandboxProvider,
  WORKSPACE_ROOT,
} from "./types";

export type DockerSandboxOptions = {
  // Identifies the deployment that owns a resource. The orphan sweep only ever considers
  // resources from its own namespace, so deployments sharing a container host (or a test run
  // next to a development worker) cannot remove each other's live workspaces.
  namespace: string;
  image: string;
  dockerBinary: string;
  runtime?: string;
  egressNetwork: string;
  cpuLimit: number;
  memoryMb: number;
  pidsLimit: number;
  tmpfsMb: number;
};

const LABEL_MANAGED = "patchline.sandbox";
const LABEL_NAMESPACE = "patchline.namespace";
const LABEL_JOB = "patchline.job";
const SANDBOX_USER = "10001:10001";
const MANAGEMENT_TIMEOUT_MS = 60_000;
const MANAGEMENT_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_OUTPUT_BYTES = 2 * 1024 * 1024;
const ABORT_KILL_DEADLINE_MS = 15_000;

const JOB_ID = /^[a-z0-9]{8,40}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The only variables repository code ever sees, besides per-request additions.
const BASE_ENVIRONMENT: Readonly<Record<string, string>> = {
  HOME: SANDBOX_HOME,
  PATH: [
    `${REPOSITORY_DIR}/node_modules/.bin`,
    `${REPOSITORY_DIR}/.venv/bin`,
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  ].join(":"),
  CI: "true",
  LANG: "C.UTF-8",
  TERM: "dumb",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  GIT_TERMINAL_PROMPT: "0",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  PYTHONDONTWRITEBYTECODE: "1",
};

function volumeNames(jobId: string) {
  return {
    workspace: `patchline-${jobId}-workspace`,
    home: `patchline-${jobId}-home`,
    publish: `patchline-${jobId}-publish`,
  };
}

export class DockerSandboxProvider implements SandboxProvider {
  constructor(private readonly options: DockerSandboxOptions) {}

  async assertReady(): Promise<void> {
    const version = await this.manage(["version", "--format", "{{.Server.Version}}"]);
    if (version.exitCode !== 0) {
      throw new SandboxError(
        `The container runtime is not reachable through "${this.options.dockerBinary}". ` +
          `Start Docker and try again. ${version.stderr.trim()}`,
      );
    }
    const image = await this.manage([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      this.options.image,
    ]);
    if (image.exitCode !== 0) {
      throw new SandboxError(
        `Sandbox image "${this.options.image}" is not available. Build it with "npm run sandbox:build".`,
      );
    }
  }

  async create(jobId: string): Promise<Sandbox> {
    if (!JOB_ID.test(jobId)) {
      throw new SandboxError("Job id is not usable as a container resource name");
    }
    for (const name of Object.values(volumeNames(jobId))) {
      const created = await this.manage([
        "volume",
        "create",
        "--label",
        `${LABEL_MANAGED}=true`,
        "--label",
        `${LABEL_NAMESPACE}=${this.options.namespace}`,
        "--label",
        `${LABEL_JOB}=${jobId}`,
        name,
      ]);
      if (created.exitCode !== 0) {
        throw new SandboxError(`Could not create sandbox volume: ${created.stderr.trim()}`);
      }
    }
    return new DockerSandbox(jobId, this.options, (args) => this.manage(args));
  }

  async removeOrphans(isActive: (jobId: string) => Promise<boolean>): Promise<string[]> {
    const listed = await this.manage([
      "volume",
      "ls",
      "--filter",
      `label=${LABEL_NAMESPACE}=${this.options.namespace}`,
      "--format",
      `{{.Label "${LABEL_JOB}"}}`,
    ]);
    if (listed.exitCode !== 0) {
      throw new SandboxError(`Could not list sandbox volumes: ${listed.stderr.trim()}`);
    }
    const jobIds = [...new Set(listed.stdout.split("\n").map((line) => line.trim()))].filter((id) =>
      JOB_ID.test(id),
    );
    const removed: string[] = [];
    for (const jobId of jobIds) {
      if (!(await isActive(jobId))) {
        await new DockerSandbox(jobId, this.options, (args) => this.manage(args)).destroy();
        removed.push(jobId);
      }
    }
    return removed;
  }

  private manage(args: readonly string[]) {
    return runCli({
      binary: this.options.dockerBinary,
      args,
      timeoutMs: MANAGEMENT_TIMEOUT_MS,
      maxOutputBytes: MANAGEMENT_OUTPUT_BYTES,
    });
  }
}

class DockerSandbox implements Sandbox {
  private sequence = 0;

  constructor(
    readonly jobId: string,
    private readonly options: DockerSandboxOptions,
    private readonly manage: (args: readonly string[]) => ReturnType<typeof runCli>,
  ) {}

  async exec(request: ExecRequest): Promise<ExecResult> {
    request.signal?.throwIfAborted();
    const containerName = `patchline-${this.jobId}-${++this.sequence}-${randomBytes(3).toString("hex")}`;
    const running = startCli({
      binary: this.options.dockerBinary,
      args: this.runArguments(containerName, request),
      stdin: request.stdin,
      extraEnv: request.secretEnv,
      maxOutputBytes: request.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
      rawOutput: request.rawOutput,
    });

    let timedOut = false;
    let killDeadline: NodeJS.Timeout | undefined;
    // Stopping the CLI does not stop the container, so the container is killed by name and
    // the CLI is only terminated if the runtime fails to confirm the kill in time.
    const kill = () => {
      void this.manage(["kill", containerName]).catch(() => undefined);
      killDeadline ??= setTimeout(running.terminate, ABORT_KILL_DEADLINE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, request.timeoutMs);
    request.signal?.addEventListener("abort", kill, { once: true });

    try {
      const result = await running.result;
      request.signal?.throwIfAborted();
      return {
        exitCode: timedOut ? null : result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut,
        truncated: result.truncated,
        durationMs: result.durationMs,
      };
    } finally {
      clearTimeout(timer);
      clearTimeout(killDeadline);
      request.signal?.removeEventListener("abort", kill);
    }
  }

  async destroy(): Promise<void> {
    const containers = await this.manage([
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=${LABEL_JOB}=${this.jobId}`,
    ]);
    const ids = containers.stdout.split("\n").filter((id) => id.trim() !== "");
    if (ids.length > 0) {
      await this.manage(["rm", "--force", ...ids]);
    }
    const removal = await this.manage([
      "volume",
      "rm",
      "--force",
      ...Object.values(volumeNames(this.jobId)),
    ]);
    if (removal.exitCode !== 0) {
      throw new SandboxError(`Could not remove sandbox volumes: ${removal.stderr.trim()}`);
    }
  }

  private runArguments(containerName: string, request: ExecRequest): string[] {
    const volumes = volumeNames(this.jobId);
    const profile = request.profile ?? "workspace";
    const tmpfsOptions = `rw,exec,nosuid,nodev,size=${this.options.tmpfsMb}m`;

    const args = [
      "run",
      "--rm",
      "--init",
      "--name",
      containerName,
      "--label",
      `${LABEL_MANAGED}=true`,
      "--label",
      `${LABEL_JOB}=${this.jobId}`,
      "--network",
      request.network === "egress" ? this.options.egressNetwork : "none",
      "--user",
      SANDBOX_USER,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      `/tmp:${tmpfsOptions}`,
      "--cpus",
      String(this.options.cpuLimit),
      "--memory",
      `${this.options.memoryMb}m`,
      "--memory-swap",
      `${this.options.memoryMb}m`,
      "--pids-limit",
      String(this.options.pidsLimit),
      "--workdir",
      request.workdir ?? WORKSPACE_ROOT,
    ];

    if (this.options.runtime) {
      args.push("--runtime", this.options.runtime);
    }

    if (profile === "workspace") {
      args.push(
        "--mount",
        `type=volume,source=${volumes.workspace},target=${WORKSPACE_ROOT}`,
        "--mount",
        `type=volume,source=${volumes.home},target=${SANDBOX_HOME}`,
      );
    } else {
      // Repository code can write to the workspace home volume, so publishing gets a
      // throwaway home instead of inheriting whatever was planted there.
      args.push(
        "--mount",
        `type=volume,source=${volumes.publish},target=${WORKSPACE_ROOT}`,
        "--tmpfs",
        `${SANDBOX_HOME}:${tmpfsOptions},uid=10001,gid=10001`,
      );
    }

    for (const [name, value] of Object.entries({ ...BASE_ENVIRONMENT, ...request.env })) {
      assertEnvName(name);
      args.push("--env", `${name}=${value}`);
    }
    for (const name of Object.keys(request.secretEnv ?? {})) {
      assertEnvName(name);
      args.push("--env", name);
    }

    if (request.stdin !== undefined) {
      args.push("--interactive");
    }
    args.push(this.options.image, ...request.argv);
    return args;
  }
}

function assertEnvName(name: string): void {
  if (!ENV_NAME.test(name)) {
    throw new SandboxError(`Invalid environment variable name: ${name}`);
  }
}
