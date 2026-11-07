import type { WorkerConfig } from "@/core/config";
import { transitionJob } from "@/core/jobs/service";
import type { Logger } from "@/core/logging/logger";
import { redactText, unregisterSecret } from "@/core/logging/redaction";
import type { Database } from "@/db";
import type { JobStatus } from "@/db/generated/enums";
import type { ModelProvider } from "../agent/model/types";
import { AgentSession, Budget } from "../agent/session";
import { shorten } from "../agent/tools";
import { type ChangeSet, GitError } from "../git/operations";
import type { Sandbox, SandboxProvider } from "../sandbox/types";
import type { GitHubGateway } from "./github-gateway";
import { JobFailure } from "./outcomes";
import { JobRecorder } from "./recorder";

const ERROR_DETAIL_CHARS = 1_500;

export type PipelineDeps = {
  config: WorkerConfig;
  db: Database;
  logger: Logger;
  github: GitHubGateway;
  sandboxes: SandboxProvider;
  model: ModelProvider;
};

export async function loadJob(db: Database, jobId: string) {
  return db.maintenanceJob.findUnique({
    where: { id: jobId },
    include: {
      repository: { include: { installation: true } },
      createdBy: { include: { identities: { select: { provider: true, login: true } } } },
    },
  });
}

export type LoadedJob = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

export function detailOf(error: unknown): string {
  const text =
    error instanceof GitError
      ? `${error.message}: ${error.detail}`
      : error instanceof Error
        ? error.message
        : String(error);
  return shorten(redactText(text.trim()), ERROR_DETAIL_CHARS);
}

// State and helpers shared by the phases of one job run.
export class RunContext {
  status: JobStatus = "PREPARING";
  readonly recorder: JobRecorder;
  readonly logger: Logger;
  // Shared by the working conversation and every review, so limits apply to the whole job.
  private readonly budget: Budget;
  private readonly issuedTokens: string[] = [];
  private currentSandbox: Sandbox | undefined;
  private currentBase: string | undefined;
  private lastStoredPatch: string | undefined;

  constructor(
    readonly deps: PipelineDeps,
    readonly job: LoadedJob,
    readonly signal: AbortSignal,
  ) {
    this.logger = deps.logger.child({ jobId: job.id, repository: job.repository.fullName });
    this.recorder = new JobRecorder(deps.db, this.logger, job.id);
    this.budget = new Budget({
      maxTurns: deps.config.agent.maxTurns,
      maxJobTokens: deps.config.agent.maxJobTokens,
    });
  }

  get repositoryRef() {
    return {
      installationId: this.job.repository.installation.githubInstallationId,
      owner: this.job.repository.ownerLogin,
      name: this.job.repository.name,
    };
  }

  get sandbox(): Sandbox {
    if (!this.currentSandbox) {
      throw new Error("The sandbox has not been created yet");
    }
    return this.currentSandbox;
  }

  get hasSandbox(): boolean {
    return this.currentSandbox !== undefined;
  }

  get baseCommitSha(): string {
    if (!this.currentBase) {
      throw new Error("The repository has not been cloned yet");
    }
    return this.currentBase;
  }

  get hasClone(): boolean {
    return this.currentBase !== undefined;
  }

  attachSandbox(sandbox: Sandbox): void {
    this.currentSandbox = sandbox;
  }

  setBaseCommit(sha: string): void {
    this.currentBase = sha;
  }

  async enter(
    to: JobStatus,
    message: string,
    patch?: { baseCommitSha?: string; workBranch?: string },
  ): Promise<void> {
    this.signal.throwIfAborted();
    await transitionJob(this.deps.db, { jobId: this.job.id, to, message, patch });
    this.status = to;
    this.logger.info({ status: to }, message);
  }

  async timed<T>(name: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await action();
      await this.recorder.event("OPERATION", `${name} finished`, {
        operation: name,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      if (!this.signal.aborted) {
        await this.recorder.event(
          "OPERATION",
          `${name} failed`,
          { operation: name, durationMs: Date.now() - startedAt, detail: detailOf(error) },
          "ERROR",
        );
      }
      throw error;
    }
  }

  async token(permissions: { contents: "read" | "write" }): Promise<string> {
    try {
      const token = await this.deps.github.repositoryToken({
        installationId: this.job.repository.installation.githubInstallationId,
        githubRepoId: this.job.repository.githubRepoId,
        permissions,
      });
      this.issuedTokens.push(token);
      return token;
    } catch (error) {
      throw new JobFailure(
        "GITHUB_ACCESS",
        `GitHub did not issue a repository token: ${detailOf(error)}`,
        { cause: error },
      );
    }
  }

  forgetTokens(): void {
    for (const token of this.issuedTokens.splice(0)) {
      unregisterSecret(token);
    }
  }

  createSession(purpose: string): AgentSession {
    const { config } = this.deps;
    return new AgentSession({
      provider: this.deps.model,
      recorder: this.recorder,
      budget: this.budget,
      cacheKey: `${this.job.id}-${purpose}`,
      toolContext: {
        sandbox: this.sandbox,
        recorder: this.recorder,
        baseCommitSha: this.baseCommitSha,
        maxOutputChars: config.agent.maxToolOutputChars,
        commandTimeoutMs: config.sandbox.commandTimeoutMs,
        signal: this.signal,
      },
    });
  }

  async storePatch(changes: ChangeSet): Promise<void> {
    if (changes.patch !== "" && changes.patch !== this.lastStoredPatch) {
      await this.recorder.artifact("DIFF", "changes.patch", "text/x-diff", changes.patch);
      this.lastStoredPatch = changes.patch;
    }
  }
}
