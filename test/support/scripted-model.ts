import type {
  ModelProvider,
  ModelTurn,
  TranscriptItem,
  TurnRequest,
} from "@/worker/agent/model/types";
import type { AgentPhase } from "@/worker/agent/tools";

export type ScriptedCall = { name: string; args: Record<string, unknown> };

export type ScriptContext = {
  // How many times this phase has been entered (1 for the first implementation round).
  round: number;
  lastToolOutput: string;
  transcriptText: string;
};

export type PhaseScript = (context: ScriptContext) => ScriptedCall[][];

const SUBMIT_TOOL_TO_PHASE: Record<string, AgentPhase> = {
  submit_analysis: "ANALYZING",
  submit_reproduction: "REPRODUCING",
  submit_plan: "PLANNING",
  submit_implementation: "IMPLEMENTING",
  submit_review: "REVIEWING",
};

function text(transcript: readonly TranscriptItem[]): string {
  return transcript
    .map((item) => ("text" in item ? item.text : "output" in item ? item.output : ""))
    .join("\n");
}

// Test double for the model provider. It replays a fixed list of tool calls per phase, so
// pipeline behaviour can be asserted deterministically against the real sandbox and database.
export class ScriptedModel implements ModelProvider {
  readonly modelId = "scripted-test-model";
  readonly reasoningEffort = "none";
  readonly requests: TurnRequest[] = [];
  private readonly rounds = new Map<AgentPhase, number>();
  private current:
    | { phase: AgentPhase; instructionCount: number; steps: ScriptedCall[][]; index: number }
    | undefined;
  private sequence = 0;

  constructor(
    private readonly scripts: Partial<Record<AgentPhase, PhaseScript>>,
    private readonly onTurn?: (request: TurnRequest) => Promise<void> | void,
  ) {}

  async createTurn(request: TurnRequest): Promise<ModelTurn> {
    request.signal?.throwIfAborted();
    this.requests.push(request);
    await this.onTurn?.(request);

    const submitTool = request.allowedTools.find((name) => name in SUBMIT_TOOL_TO_PHASE);
    const phase = submitTool ? SUBMIT_TOOL_TO_PHASE[submitTool] : undefined;
    if (!phase) {
      throw new Error("Scripted model could not determine the phase");
    }
    const instructionCount = request.transcript.filter(
      (item) => item.kind === "instruction",
    ).length;
    if (
      !this.current ||
      this.current.phase !== phase ||
      this.current.instructionCount !== instructionCount
    ) {
      const round = (this.rounds.get(phase) ?? 0) + 1;
      this.rounds.set(phase, round);
      const script = this.scripts[phase];
      if (!script) {
        throw new Error(`No script for phase ${phase}`);
      }
      this.current = {
        phase,
        instructionCount,
        index: 0,
        steps: script(this.context(request, round)),
      };
    }

    const step = this.current.steps[this.current.index];
    this.current.index += 1;
    if (!step) {
      throw new Error(`Script for ${phase} ran out of steps`);
    }
    const calls = step.map((call) => ({
      callId: `call_${(this.sequence += 1)}`,
      name: call.name,
      arguments: JSON.stringify(this.resolve(call.args, request)),
    }));
    return {
      responseId: `resp_${this.sequence}`,
      toolCalls: calls,
      text: "",
      outputItems: calls.map((call) => ({
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      })),
      truncated: false,
      usage: { inputTokens: 1_000, cachedInputTokens: 600, outputTokens: 100, reasoningTokens: 40 },
      estimatedCostUsd: 0.0123,
      durationMs: 5,
      retryCount: 0,
    };
  }

  private context(request: TurnRequest, round: number): ScriptContext {
    const outputs = request.transcript.filter((item) => item.kind === "tool_result");
    const last = outputs.at(-1);
    return {
      round,
      lastToolOutput: last?.kind === "tool_result" ? last.output : "",
      transcriptText: text(request.transcript),
    };
  }

  // "$LAST_COMMAND_ID" is replaced by the id reported by the most recent run_command result.
  private resolve(args: Record<string, unknown>, request: TurnRequest): Record<string, unknown> {
    const ids = [...text(request.transcript).matchAll(/command_id: (\S+)/g)];
    const lastId = ids.at(-1)?.[1] ?? null;
    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => [
        key,
        value === "$LAST_COMMAND_ID" ? lastId : value,
      ]),
    );
  }
}
