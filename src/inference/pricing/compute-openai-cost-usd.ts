import { resolveOpenAiModelPricing } from './openai-model-pricing';

export type OpenAiTokenUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
};

/**
 * Estimates USD cost from token counts and OpenAI list pricing (per 1M tokens).
 * Returns `null` when the model id is not in the catalog.
 */
export function computeOpenAiCostUsd(usage: OpenAiTokenUsage): number | null {
  const pricing = resolveOpenAiModelPricing(usage.model);
  if (!pricing) {
    return null;
  }

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;
  return roundUsd(inputCost + outputCost);
}

export function sumOpenAiCostsUsd(costs: Array<number | null>): number | null {
  if (costs.length === 0) {
    return null;
  }
  let total = 0;
  for (const c of costs) {
    if (c == null) {
      return null;
    }
    total += c;
  }
  return roundUsd(total);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
