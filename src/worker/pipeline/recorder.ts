import { createHash } from "node:crypto";
import { recordEvent } from "@/core/jobs/service";
import { redactText, redactValue } from "@/core/logging/redaction";
import type { Logger } from "@/core/logging/logger";
import type { Database, Prisma } from "@/db";
import type {
  ArtifactKind,
  CommandSource,
  EventLevel,
  JobEventType,
  JobStatus,
  VerificationCategory,
  VerificationStage,
  VerificationStatus,
} from "@/db/generated/enums";
import type { ModelTurn } from "../agent/model/types";

const MAX_STORED_OUTPUT_CHARS = 200_000;

export type CommandRecord = {
  source: CommandSource;
  phase: JobStatus;
  command: string;
  purpose?: string;
  networkEnabled: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
  outputTruncated: boolean;
  startedAt: Date;
};

function clampOutput(output: string): { text: string; clamped: boolean } {
  if (output.length <= MAX_STORED_OUTPUT_CHARS) {
    return { text: output, clamped: false };
  }
  const head = output.slice(0, MAX_STORED_OUTPUT_CHARS / 4);
  const tail = output.slice(-(MAX_STORED_OUTPUT_CHARS * 3) / 4);
  return { text: `${head}\n[... output shortened for storage ...]\n${tail}`, clamped: true };
}

// Everything a job does is written through here, so redaction and the job id are applied
// in one place and the user-visible evidence matches the structured logs.
export class JobRecorder {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    readonly jobId: string,
  ) {}

  async event(
    type: JobEventType,
    message: string,
    data?: Record<string, unknown>,
    level: EventLevel = "INFO",
  ): Promise<void> {
    this.logger[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "info"](
      { eventType: type, ...data },
      message,
    );
    await recordEvent(this.db, { jobId: this.jobId, type, level, message, data });
  }

  async command(record: CommandRecord): Promise<string> {
    const { text, clamped } = clampOutput(redactText(record.output));
    const row = await this.db.commandExecution.create({
      data: {
        jobId: this.jobId,
        source: record.source,
        phase: record.phase,
        command: redactText(record.command),
        purpose: record.purpose ? redactText(record.purpose) : undefined,
        networkEnabled: record.networkEnabled,
        exitCode: record.exitCode,
        timedOut: record.timedOut,
        durationMs: record.durationMs,
        output: text,
        outputTruncated: record.outputTruncated || clamped,
        startedAt: record.startedAt,
        finishedAt: new Date(record.startedAt.getTime() + record.durationMs),
      },
    });
    await this.event(
      "COMMAND",
      record.command.length > 200 ? `${record.command.slice(0, 200)}...` : record.command,
      {
        commandId: row.id,
        source: record.source,
        exitCode: record.exitCode,
        timedOut: record.timedOut,
        durationMs: record.durationMs,
        network: record.networkEnabled,
      },
      record.timedOut ? "WARN" : "INFO",
    );
    return row.id;
  }

  async verification(run: {
    commandExecutionId: string;
    stage: VerificationStage;
    iteration: number;
    category: VerificationCategory;
    command: string;
    status: VerificationStatus;
    exitCode: number | null;
    durationMs: number;
    startedAt: Date;
  }): Promise<void> {
    await this.db.verificationRun.create({
      data: {
        jobId: this.jobId,
        ...run,
        finishedAt: new Date(run.startedAt.getTime() + run.durationMs),
      },
    });
    await this.event(
      "VERIFICATION",
      `${run.category} ${run.status}`,
      {
        stage: run.stage,
        iteration: run.iteration,
        category: run.category,
        status: run.status,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
      },
      run.status === "PASSED" ? "INFO" : "WARN",
    );
  }

  async modelTurn(
    phase: JobStatus,
    model: { id: string; effort: string },
    turn: ModelTurn,
  ): Promise<void> {
    const cost = turn.estimatedCostUsd;
    await this.db.$transaction([
      this.db.modelInvocation.create({
        data: {
          jobId: this.jobId,
          phase,
          model: model.id,
          reasoningEffort: model.effort,
          responseId: turn.responseId,
          status: "SUCCEEDED",
          retryCount: turn.retryCount,
          durationMs: turn.durationMs,
          ...turn.usage,
          estimatedCostUsd: cost,
        },
      }),
      this.db.maintenanceJob.update({
        where: { id: this.jobId },
        data: {
          modelTurns: { increment: 1 },
          inputTokens: { increment: turn.usage.inputTokens },
          cachedInputTokens: { increment: turn.usage.cachedInputTokens },
          outputTokens: { increment: turn.usage.outputTokens },
          reasoningTokens: { increment: turn.usage.reasoningTokens },
          ...(cost === null ? {} : { estimatedCostUsd: { increment: cost } }),
        },
      }),
    ]);
    await this.event("MODEL_CALL", `Model responded with ${turn.toolCalls.length} tool call(s)`, {
      phase,
      durationMs: turn.durationMs,
      retryCount: turn.retryCount,
      inputTokens: turn.usage.inputTokens,
      cachedInputTokens: turn.usage.cachedInputTokens,
      outputTokens: turn.usage.outputTokens,
      reasoningTokens: turn.usage.reasoningTokens,
    });
  }

  async modelFailure(
    phase: JobStatus,
    model: { id: string; effort: string },
    failure: { category: string; retryCount: number; durationMs: number; message: string },
  ): Promise<void> {
    await this.db.modelInvocation.create({
      data: {
        jobId: this.jobId,
        phase,
        model: model.id,
        reasoningEffort: model.effort,
        status: "FAILED",
        errorCategory: failure.category,
        retryCount: failure.retryCount,
        durationMs: failure.durationMs,
      },
    });
    await this.event(
      "ERROR",
      failure.message,
      {
        phase,
        errorCategory: failure.category,
        retryCount: failure.retryCount,
        durationMs: failure.durationMs,
      },
      "ERROR",
    );
  }

  async artifact(
    kind: ArtifactKind,
    name: string,
    contentType: string,
    content: string,
  ): Promise<void> {
    await this.db.jobArtifact.create({
      data: {
        jobId: this.jobId,
        kind,
        name,
        contentType,
        content,
        sizeBytes: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    });
  }

  // Structured results are model-written prose and may quote repository content, so they are
  // scrubbed. Patches are stored through artifact() untouched because they must apply exactly.
  async jsonArtifact(kind: ArtifactKind, name: string, value: unknown): Promise<void> {
    await this.artifact(
      kind,
      name,
      "application/json",
      JSON.stringify(redactValue(value), null, 2),
    );
  }

  async setRepairIterations(iterations: number): Promise<void> {
    await this.db.maintenanceJob.update({
      where: { id: this.jobId },
      data: { repairIterations: iterations },
    });
  }

  async commandOutput(commandId: string): Promise<string | null> {
    const row = await this.db.commandExecution.findFirst({
      where: { id: commandId, jobId: this.jobId },
      select: { output: true },
    });
    return row?.output ?? null;
  }

  async patchJob(data: Prisma.MaintenanceJobUpdateInput): Promise<void> {
    await this.db.maintenanceJob.update({ where: { id: this.jobId }, data });
  }
}
