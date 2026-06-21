/** OpenAI Chat Completions: some models use max_completion_tokens instead of max_tokens. */
export function openAiChatMaxOutputParam(
  model: string,
  maxTokens: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  const n = Math.max(1, Math.floor(maxTokens));
  const id = model.trim().toLowerCase();
  const useCompletionCap =
    id.startsWith('gpt-5') || /^o[0-9]/.test(id) || id.startsWith('o1') || id.startsWith('o3');
  return useCompletionCap ? { max_completion_tokens: n } : { max_tokens: n };
}

/** GPT-5 and o-series models reject `temperature` on OpenAI Chat + Responses APIs. */
export function openAiSupportsTemperature(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (id.startsWith('gpt-5')) return false;
  if (/^o[0-9]/.test(id) || id.startsWith('o1') || id.startsWith('o3')) return false;
  return true;
}
