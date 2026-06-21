/** Routed inference backends (OpenAI-compatible or native). */
export enum InferenceProviderKind {
  OPENAI_DIRECT = 'openai_direct',
  CLAUDE_DIRECT = 'claude_direct',
  OPENROUTER = 'openrouter',
  HUGGING_FACE = 'hugging_face',
  INFERENCE_NET = 'inference_net',
  OLLAMA = 'ollama',
  GROK_DIRECT = 'grok_direct',
  GEMINI_DIRECT = 'gemini_direct',
}
