import type { z } from "zod";

export type ToolSpec = {
  name: string;
  description: string;
  parameters: z.ZodType;
};

// Provider-neutral conversation state. "model" items are opaque provider output (reasoning,
// tool calls, messages) replayed verbatim on the next request.
export type TranscriptItem =
  | { kind: "task"; text: string }
  | { kind: "instruction"; text: string }
  | { kind: "model"; items: readonly unknown[] }
  | { kind: "tool_result"; callId: string; output: string };

export type ToolCall = {
  callId: string;
  name: string;
  arguments: string;
};

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type ModelTurn = {
  responseId: string | null;
  toolCalls: ToolCall[];
  text: string;
  outputItems: readonly unknown[];
  truncated: boolean;
  usage: TokenUsage;
  estimatedCostUsd: number | null;
  durationMs: number;
  retryCount: number;
};

export type TurnRequest = {
  instructions: string;
  transcript: readonly TranscriptItem[];
  tools: readonly ToolSpec[];
  allowedTools: readonly string[];
  cacheKey: string;
  signal?: AbortSignal;
};

export interface ModelProvider {
  readonly modelId: string;
  readonly reasoningEffort: string;
  createTurn(request: TurnRequest): Promise<ModelTurn>;
}

export type ModelFailureCategory =
  "authentication" | "invalid_request" | "rate_limited" | "unavailable" | "timeout";

export class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly category: ModelFailureCategory,
    readonly retryCount: number,
    readonly durationMs: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelProviderError";
  }
}
