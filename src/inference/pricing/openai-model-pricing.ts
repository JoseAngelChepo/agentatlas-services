/**
 * Standard OpenAI API list prices (USD per 1M tokens), input / output.
 * Source: https://developers.openai.com/api/docs/pricing (Standard tier).
 * Cached-input rates are not applied here — usage is billed at list input/output only.
 */
export type OpenAiModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

/** Longest keys first so versioned ids match the most specific entry. */
const OPENAI_MODEL_PRICING_USD: Record<string, OpenAiModelPricing> = {
  'gpt-5.5-pro': { inputPer1M: 30, outputPer1M: 180 },
  'gpt-5.5': { inputPer1M: 5, outputPer1M: 30 },
  'gpt-5.4-pro': { inputPer1M: 30, outputPer1M: 180 },
  'gpt-5.4-mini': { inputPer1M: 0.75, outputPer1M: 4.5 },
  'gpt-5.4-nano': { inputPer1M: 0.2, outputPer1M: 1.25 },
  'gpt-5.4': { inputPer1M: 2.5, outputPer1M: 15 },
  'gpt-5.2-pro': { inputPer1M: 21, outputPer1M: 168 },
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14 },
  'gpt-5.1': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-5-pro': { inputPer1M: 15, outputPer1M: 120 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2 },
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.4 },
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4o-2024-05-13': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'o3-pro': { inputPer1M: 20, outputPer1M: 80 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'o3': { inputPer1M: 2, outputPer1M: 8 },
  'o1-pro': { inputPer1M: 150, outputPer1M: 600 },
  'o1-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  o1: { inputPer1M: 15, outputPer1M: 60 },
  'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30 },
  'gpt-4': { inputPer1M: 30, outputPer1M: 60 },
  'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },
};

const SORTED_KEYS = Object.keys(OPENAI_MODEL_PRICING_USD).sort(
  (a, b) => b.length - a.length,
);

/** Strips dated suffixes (`gpt-4o-mini-2024-07-18`) for catalog lookup. */
export function normalizeOpenAiModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function resolveOpenAiModelPricing(model: string): OpenAiModelPricing | null {
  const id = normalizeOpenAiModelId(model);
  if (!id) {
    return null;
  }

  const exact = OPENAI_MODEL_PRICING_USD[id];
  if (exact) {
    return exact;
  }

  for (const key of SORTED_KEYS) {
    if (id === key || id.startsWith(`${key}-`)) {
      const pricing = OPENAI_MODEL_PRICING_USD[key];
      if (pricing) {
        return pricing;
      }
    }
  }

  return null;
}

export function listOpenAiModelPricingCatalog(): Array<{ model: string } & OpenAiModelPricing> {
  return SORTED_KEYS.map((model) => {
    const pricing = OPENAI_MODEL_PRICING_USD[model]!;
    return { model, ...pricing };
  });
}
