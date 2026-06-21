/** Per-worker OpenAI Responses API tools (`openai_direct` only). */
export type OpenAiWorkerToolsConfig = {
  /** Hosted web search (`{ type: "web_search" }`). */
  webSearch?: boolean;
  webSearchContextSize?: 'low' | 'medium' | 'high';
  /** Domain allowlist (max 100). Omit protocol, e.g. `openai.com`. */
  webSearchAllowedDomains?: string[];
  /** `auto` | `required` | `none` — default `auto`. */
  toolChoice?: 'auto' | 'required' | 'none';
  /** Custom function tools (Responses API `function` tool). */
  functions?: OpenAiFunctionToolDefinition[];
  /**
   * Additional hosted tools, e.g. `{ "type": "file_search", "vector_store_ids": ["..."] }`.
   * Passed through to the API as-is.
   */
  hosted?: Array<Record<string, unknown>>;
};

export type OpenAiFunctionToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
};
