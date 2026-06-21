/**
 * Firecrawl scrape list pricing (credit-based estimate).
 * @see https://www.firecrawl.dev/pricing
 */
export const FIRECRAWL_SCRAPE_USD_PER_REQUEST = 0.001;

/** Typical scrape duration when `latencyMs` was not recorded. */
export const FIRECRAWL_SCRAPE_DEFAULT_REQUEST_MS = 3_000;

export function computeScrapeCostUsd(_browserDurationMs?: number): number {
  return roundUsd(FIRECRAWL_SCRAPE_USD_PER_REQUEST);
}

export function effectiveScrapeRequestDurationMs(latencyMs: number | undefined): number {
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs > 0) {
    return Math.floor(latencyMs);
  }
  return FIRECRAWL_SCRAPE_DEFAULT_REQUEST_MS;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
