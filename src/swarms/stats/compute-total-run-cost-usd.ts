/** LLM (`costUsd`, OpenAI) + browser scraping (`scrapeCostUsd`). */
export function computeTotalRunCostUsd(
  llmCostUsd: number | null,
  scrapeCostUsd: number,
): number {
  return Math.round(((llmCostUsd ?? 0) + scrapeCostUsd) * 1_000_000) / 1_000_000;
}
