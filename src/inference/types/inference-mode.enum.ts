/** How swarm worker runs choose between LLM and stub executor. */
export enum InferenceMode {
  /** Use LLM when the worker's provider is configured; otherwise stub. */
  AUTO = 'auto',
  /** Always call the configured LLM provider (fail if missing keys). */
  LLM = 'llm',
  /** Never call upstream models (workspace dev / offline). */
  STUB = 'stub',
}
