/**
 * Cloudflare Browser Run list pricing (no free tier applied in estimates).
 * @see https://developers.cloudflare.com/browser-rendering/pricing/
 */
export const BROWSER_SCRAPE_USD_PER_HOUR = 0.09;

/** Typical scrape duration when `latencyMs` was not recorded (~2–3s). */
export const BROWSER_SCRAPE_DEFAULT_REQUEST_MS = 2_500;

export function computeBrowserScrapeCostUsd(browserDurationMs: number): number {
  if (browserDurationMs <= 0) {
    return 0;
  }
  const hours = browserDurationMs / 3_600_000;
  return roundUsd(hours * BROWSER_SCRAPE_USD_PER_HOUR);
}

export function effectiveScrapeRequestDurationMs(latencyMs: number | undefined): number {
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs > 0) {
    return Math.floor(latencyMs);
  }
  return BROWSER_SCRAPE_DEFAULT_REQUEST_MS;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
