import type { ScrapeRequestDocument } from '../../scraper/schemas/scrape-request.schema';
import type { AgentRunDocument } from '../schemas/agent-run.schema';
import {
  buildModelUsageReport,
  rollupOpenAiCostUsd,
  type SwarmRunModelUsageLine,
} from './build-model-usage-report';
import { buildScrapeUsageReport, type SwarmRunScrapeUsageReport } from './build-scrape-usage-report';
import { computeLayeredDurationMs } from './compute-layered-duration-ms';
import { computeTotalRunCostUsd } from './compute-total-run-cost-usd';

export type SwarmRunStats = {
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** `null` when no OpenAI-direct usage or an OpenAI model has no catalog price. */
  costUsd: number | null;
  scrapeCostUsd: number;
  totalCostUsd: number;
  usageByModel: SwarmRunModelUsageLine[];
  scrapeUsage: SwarmRunScrapeUsageReport;
};

export function aggregateSwarmRunStats(params: {
  waveMaxDurationsMs: number[];
  agentRuns: AgentRunDocument[];
  scrapeRequests: ScrapeRequestDocument[];
}): SwarmRunStats {
  const durationMs = computeLayeredDurationMs(params.waveMaxDurationsMs);
  const usageByModel = buildModelUsageReport(params.agentRuns);
  const scrapeUsage = buildScrapeUsageReport(params.scrapeRequests);

  let promptTokens = 0;
  let completionTokens = 0;
  for (const line of usageByModel) {
    promptTokens += line.promptTokens;
    completionTokens += line.completionTokens;
  }

  const totalTokens = promptTokens + completionTokens;
  const costUsd = rollupOpenAiCostUsd(usageByModel);
  const scrapeCostUsd = scrapeUsage.costUsd;
  const totalCostUsd = computeTotalRunCostUsd(costUsd, scrapeCostUsd);

  return {
    durationMs,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    scrapeCostUsd,
    totalCostUsd,
    usageByModel,
    scrapeUsage,
  };
}
