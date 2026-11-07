import { setTimeout as sleep } from "node:timers/promises";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import { zodResponsesFunction } from "openai/helpers/zod";
import type {
  FunctionTool,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { ModelPricing, WorkerConfig } from "@/core/config";
import { redactText } from "@/core/logging/redaction";
import {
  type ModelFailureCategory,
  type ModelProvider,
  ModelProviderError,
  type ModelTurn,
  type TokenUsage,
  type ToolSpec,
  type TranscriptItem,
  type TurnRequest,
} from "./types";

const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;
const RETRYABLE_STATUS = new Set([408, 409, 429]);

export function estimateCostUsd(
  usage: TokenUsage,
  pricing: ModelPricing | undefined,
): number | null {
  if (!pricing) {
    return null;
  }
  const uncachedInput = Math.max(usage.inputTokens - usage.cachedInputTokens, 0);
  return (
    (uncachedInput * pricing.inputPerMTok +
      usage.cachedInputTokens * pricing.cachedInputPerMTok +
      usage.outputTokens * pricing.outputPerMTok) /
    1_000_000
  );
}

function toInputItems(transcript: readonly TranscriptItem[]): ResponseInputItem[] {
  return transcript.flatMap((item): ResponseInputItem[] => {
    switch (item.kind) {
      case "task":
        return [{ type: "message", role: "user", content: item.text }];
      case "instruction":
        return [{ type: "message", role: "developer", content: item.text }];
      case "model":
        return item.items as ResponseInputItem[];
      case "tool_result":
        return [{ type: "function_call_output", call_id: item.callId, output: item.output }];
    }
  });
}

function classify(error: unknown): { category: ModelFailureCategory; retryable: boolean } {
  if (error instanceof APIConnectionTimeoutError) {
    return { category: "timeout", retryable: true };
  }
  if (error instanceof APIConnectionError) {
    return { category: "unavailable", retryable: true };
  }
  if (error instanceof APIError && typeof error.status === "number") {
    if (error.status === 401 || error.status === 403) {
      return { category: "authentication", retryable: false };
    }
    if (error.status === 429) {
      // An exhausted quota is reported as 429 too, and waiting does not fix it.
      return { category: "rate_limited", retryable: error.code !== "insufficient_quota" };
    }
    if (RETRYABLE_STATUS.has(error.status) || error.status >= 500) {
      return { category: "unavailable", retryable: true };
    }
    return { category: "invalid_request", retryable: false };
  }
  return { category: "unavailable", retryable: false };
}

function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof APIError && error.headers) {
    const retryAfter = Number(error.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, RETRY_MAX_DELAY_MS);
    }
  }
  const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return exponential / 2 + Math.random() * (exponential / 2);
}

// The single place where model selection, reasoning effort, output budget, timeout, retry
// policy and cost estimation are applied. Nothing else in the worker talks to the model API.
export class OpenAIModelProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly toolCache = new WeakMap<readonly ToolSpec[], FunctionTool[]>();

  constructor(private readonly config: WorkerConfig["model"]) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.requestTimeoutMs,
      // Retries are handled here so that each invocation can report how many it needed.
      maxRetries: 0,
    });
  }

  get modelId(): string {
    return this.config.id;
  }

  get reasoningEffort(): string {
    return this.config.reasoningEffort;
  }

  async createTurn(request: TurnRequest): Promise<ModelTurn> {
    const startedAt = Date.now();
    const params: ResponseCreateParamsNonStreaming = {
      model: this.config.id,
      instructions: request.instructions,
      input: toInputItems(request.transcript),
      tools: this.functionTools(request.tools),
      tool_choice: {
        type: "allowed_tools",
        mode: "required",
        tools: request.allowedTools.map((name) => ({ type: "function", name })),
      },
      parallel_tool_calls: true,
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: this.config.maxOutputTokens,
      // Nothing is retained by the provider between calls. Reasoning state travels in the
      // transcript as encrypted items instead.
      store: false,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: request.cacheKey,
      truncation: "disabled",
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.client.responses.create(params, { signal: request.signal });
        const usage: TokenUsage = {
          inputTokens: response.usage?.input_tokens ?? 0,
          cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        };
        return {
          responseId: response.id,
          toolCalls: response.output.flatMap((item) =>
            item.type === "function_call"
              ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }]
              : [],
          ),
          text: response.output_text,
          outputItems: response.output,
          truncated: response.status === "incomplete",
          usage,
          estimatedCostUsd: estimateCostUsd(usage, this.config.pricing),
          durationMs: Date.now() - startedAt,
          retryCount: attempt,
        };
      } catch (error) {
        if (error instanceof APIUserAbortError || request.signal?.aborted) {
          throw request.signal?.reason ?? error;
        }
        const { category, retryable } = classify(error);
        if (!retryable || attempt >= this.config.maxRetries) {
          const detail = error instanceof Error ? redactText(error.message) : "unknown error";
          throw new ModelProviderError(
            `Model request failed (${category}): ${detail}`,
            category,
            attempt,
            Date.now() - startedAt,
            { cause: error },
          );
        }
        await sleep(retryDelayMs(error, attempt), undefined, { signal: request.signal });
      }
    }
  }

  private functionTools(tools: readonly ToolSpec[]): FunctionTool[] {
    let converted = this.toolCache.get(tools);
    if (!converted) {
      converted = tools.map((tool) => {
        const { type, name, description, parameters, strict } = zodResponsesFunction(tool);
        return { type, name, description, parameters, strict };
      });
      this.toolCache.set(tools, converted);
    }
    return converted;
  }
}
