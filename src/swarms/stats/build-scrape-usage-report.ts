import type { ScrapeRequestDocument } from '../../scraper/schemas/scrape-request.schema';
import {
  computeBrowserScrapeCostUsd,
  effectiveScrapeRequestDurationMs,
} from '../../scraper/pricing/browser-scrape-pricing';

export type SwarmRunScrapeRequestLine = {
  scrapeRequestId: string;
  url: string;
  latencyMs: number;
  costUsd: number;
  status: string;
};

export type SwarmRunScrapeUsageReport = {
  requestCount: number;
  browserDurationMs: number;
  costUsd: number;
  requests: SwarmRunScrapeRequestLine[];
};

export function buildScrapeUsageReport(
  scrapeRequests: ScrapeRequestDocument[],
): SwarmRunScrapeUsageReport {
  const requests: SwarmRunScrapeRequestLine[] = scrapeRequests.map((doc) => {
    const latencyMs = effectiveScrapeRequestDurationMs(doc.latencyMs);
    return {
      scrapeRequestId: doc.id,
      url: doc.url,
      latencyMs,
      costUsd: computeBrowserScrapeCostUsd(latencyMs),
      status: doc.status,
    };
  });

  requests.sort((a, b) => b.latencyMs - a.latencyMs);

  let browserDurationMs = 0;
  let costUsd = 0;
  for (const line of requests) {
    browserDurationMs += line.latencyMs;
    costUsd += line.costUsd;
  }

  return {
    requestCount: requests.length,
    browserDurationMs,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    requests,
  };
}
