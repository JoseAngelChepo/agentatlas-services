/** Per-worker xAI Responses API tools (`grok_direct` only). */
export type GrokWorkerToolsConfig = {
  /**
   * Hosted X search (`{ type: "x_search" }`).
   * Server may invoke `x_keyword_search`, `x_semantic_search`, `x_user_search`, `x_thread_fetch`.
   */
  xSearch?: boolean;
  /** Max 20 handles (without @). Mutually exclusive with excluded handles. */
  xSearchAllowedHandles?: string[];
  xSearchExcludedHandles?: string[];
  /** ISO8601 date, e.g. `2025-10-01`. */
  xSearchFromDate?: string;
  xSearchToDate?: string;
  xSearchEnableImageUnderstanding?: boolean;
  xSearchEnableVideoUnderstanding?: boolean;
  /** Hosted web search on xAI (`{ type: "web_search" }`). */
  webSearch?: boolean;
  /** `auto` | `required` | `none` — default `auto`. */
  toolChoice?: 'auto' | 'required' | 'none';
};
