import type { InferenceProviderKind } from './inference-provider-kind.enum';
import type { GrokWorkerToolsConfig } from './grok-worker-tools.types';
import type { OpenAiWorkerToolsConfig } from './openai-worker-tools.types';

export type ChatMessageRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatMessageRole;
  content: string;
};

export type ChatCompletionUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatCompletionRequest = {
  provider: InferenceProviderKind;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  /** JSON object response when supported (OpenAI-compatible providers). */
  jsonMode?: boolean;
  /** Worker output contract — OpenAI direct uses API json_schema when set. */
  outputSchema?: Record<string, unknown>;
  /** OpenAI json_schema name (defaults to `worker_output`). */
  structuredOutputName?: string;
  /** OpenAI Responses API tools (`web_search`, functions, …) — `openai_direct` + official API only. */
  openaiTools?: OpenAiWorkerToolsConfig;
  /** xAI Responses API tools (`x_search`, `web_search`, …) — `grok_direct` only. */
  grokTools?: GrokWorkerToolsConfig;
};

export type ChatCompletionResult = {
  text: string;
  finishReason?: string;
  usage?: ChatCompletionUsage;
  provider: InferenceProviderKind;
  baseURL: string;
  model: string;
  latencyMs: number;
  /** Provider-specific HTTP/API payload that was sent. */
  rawRequest?: Record<string, unknown>;
  /** Optional provider-specific raw response body/chunks summary. */
  rawResponse?: Record<string, unknown>;
};
