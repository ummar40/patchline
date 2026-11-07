import { createHash } from "node:crypto";
import { NeedsHumanError } from "../pipeline/outcomes";
import type { JobRecorder } from "../pipeline/recorder";
import {
  type ModelProvider,
  ModelProviderError,
  type TokenUsage,
  type TranscriptItem,
} from "./model/types";
import { SYSTEM_INSTRUCTIONS } from "./prompts";
import {
  type AgentPhase,
  PHASE_TOOLS,
  type Submission,
  TOOL_SPECS,
  type ToolContext,
  executeToolCall,
} from "./tools";

const MAX_IDLE_TURNS = 3;
const REPEAT_WARNING_AT = 3;
const REPEAT_LIMIT = 6;

export class Budget {
  private turns = 0;
  private tokens = 0;

  constructor(private readonly limits: { maxTurns: number; maxJobTokens: number }) {}

  assertAvailable(): void {
    if (this.turns >= this.limits.maxTurns) {
      throw new NeedsHumanError(
        "LIMIT_EXCEEDED",
        `The job used its limit of ${this.limits.maxTurns} model calls before the work was finished.`,
      );
    }
    if (this.tokens >= this.limits.maxJobTokens) {
      throw new NeedsHumanError(
        "LIMIT_EXCEEDED",
        `The job used its limit of ${this.limits.maxJobTokens} model tokens before the work was finished.`,
      );
    }
  }

  record(usage: TokenUsage): void {
    this.turns += 1;
    this.tokens += usage.inputTokens + usage.outputTokens;
  }
}

function describeCall(name: string, rawArguments: string): string {
  try {
    const args = JSON.parse(rawArguments) as Record<string, unknown>;
    const detail = [args.path, args.query, args.revision, args.command_id].find(
      (value) => typeof value === "string",
    );
    return typeof detail === "string" ? `${name} ${detail.slice(0, 160)}` : name;
  } catch {
    return name;
  }
}

type SubmissionValue<Kind extends Submission["kind"]> = Extract<
  Submission,
  { kind: Kind }
>["value"];

// One conversation with the model. The platform appends a phase instruction, then this loop
// lets the model use tools until it calls that phase's submit tool or a limit stops it.
export class AgentSession {
  private readonly transcript: TranscriptItem[] = [];
  private readonly repeats = new Map<string, number>();

  constructor(
    private readonly deps: {
      provider: ModelProvider;
      recorder: JobRecorder;
      budget: Budget;
      cacheKey: string;
      toolContext: Omit<ToolContext, "phase">;
    },
  ) {}

  addTask(text: string): void {
    this.transcript.push({ kind: "task", text });
  }

  addInstruction(text: string): void {
    this.transcript.push({ kind: "instruction", text });
  }

  async runPhase<Kind extends Exclude<Submission["kind"], "human">>(
    phase: AgentPhase,
    expected: Kind,
  ): Promise<SubmissionValue<Kind>> {
    const { provider, recorder, budget } = this.deps;
    const context: ToolContext = { ...this.deps.toolContext, phase };
    const model = { id: provider.modelId, effort: provider.reasoningEffort };
    let idleTurns = 0;

    for (;;) {
      context.signal.throwIfAborted();
      budget.assertAvailable();

      const turn = await provider
        .createTurn({
          instructions: SYSTEM_INSTRUCTIONS,
          transcript: this.transcript,
          tools: TOOL_SPECS,
          allowedTools: PHASE_TOOLS[phase],
          cacheKey: this.deps.cacheKey,
          signal: context.signal,
        })
        .catch(async (error: unknown) => {
          if (error instanceof ModelProviderError) {
            await recorder.modelFailure(phase, model, {
              category: error.category,
              retryCount: error.retryCount,
              durationMs: error.durationMs,
              message: error.message,
            });
          }
          throw error;
        });

      budget.record(turn.usage);
      await recorder.modelTurn(phase, model, turn);
      this.transcript.push({ kind: "model", items: turn.outputItems });

      if (turn.toolCalls.length === 0) {
        idleTurns += 1;
        if (idleTurns >= MAX_IDLE_TURNS) {
          throw new NeedsHumanError(
            "MODEL_BEHAVIOR",
            `The model stopped using tools during the ${phase.toLowerCase()} phase, so the work could not continue.`,
          );
        }
        this.addInstruction(
          turn.truncated
            ? "Your previous response was cut off by the output limit. Continue with a tool call and keep responses short."
            : `Continue by calling a tool. Finish the phase with submit_${expected}.`,
        );
        continue;
      }
      idleTurns = 0;

      let submission: Submission | undefined;
      for (const call of turn.toolCalls) {
        // Every call needs a result in the transcript, including ones made after a submit.
        if (submission) {
          this.transcript.push({
            kind: "tool_result",
            callId: call.callId,
            output: "Skipped: the phase had already ended.",
          });
          continue;
        }
        const outcome = await executeToolCall(call, phase, context);
        let output = outcome.output;

        if (outcome.submission) {
          submission = outcome.submission;
        } else {
          if (outcome.mutated) {
            // The same test command after an edit is progress, not a loop.
            this.repeats.clear();
          }
          const repeats = this.noteRepeat(
            outcome.fingerprint === undefined
              ? `${call.name}\n${call.arguments}\n${output}`
              : `${call.name}\n${outcome.fingerprint}`,
          );
          if (repeats >= REPEAT_LIMIT) {
            throw new NeedsHumanError(
              "MODEL_BEHAVIOR",
              `The model repeated the same ${call.name} call ${repeats} times with the same result and made no further progress.`,
            );
          }
          if (repeats >= REPEAT_WARNING_AT) {
            output += `\n[Notice: this exact call has now returned the same result ${repeats} times. Repeating it will not help; take a different step.]`;
          }
          if (call.name !== "run_command") {
            await recorder.event("TOOL_CALL", describeCall(call.name, call.arguments), {
              tool: call.name,
              phase,
              failed: outcome.failed === true,
            });
          }
        }
        this.transcript.push({ kind: "tool_result", callId: call.callId, output });
      }

      if (submission?.kind === "human") {
        throw new NeedsHumanError("AGENT_ESCALATION", submission.value.reason);
      }
      if (submission?.kind === expected) {
        await recorder.event("DECISION", `${expected} submitted`, { phase });
        return submission.value as SubmissionValue<Kind>;
      }
    }
  }

  private noteRepeat(identity: string): number {
    const key = createHash("sha256").update(identity).digest("hex");
    const count = (this.repeats.get(key) ?? 0) + 1;
    this.repeats.set(key, count);
    return count;
  }
}
