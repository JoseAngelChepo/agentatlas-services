import { InferenceProviderKind } from '../../inference/types/inference-provider-kind.enum';
import { computeOpenAiCostUsd } from '../../inference/pricing/compute-openai-cost-usd';
import type { AgentRunDocument } from '../schemas/agent-run.schema';
import { extractAgentRunInferenceUsage } from './extract-agent-run-usage';

export type SwarmRunModelUsageLine = {
  provider: InferenceProviderKind;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenAI list-price USD for this model line; `null` for other providers or unknown models. */
  costUsd: number | null;
  agentRunCount: number;
};

type ModelUsageBucket = SwarmRunModelUsageLine;

function modelUsageKey(provider: InferenceProviderKind, model: string): string {
  return `${provider}\0${model}`;
}

function costUsdForLine(
  provider: InferenceProviderKind,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  if (provider !== InferenceProviderKind.OPENAI_DIRECT || !model) {
    return null;
  }
  return computeOpenAiCostUsd({ model, promptTokens, completionTokens });
}

/** Per provider+model token and cost breakdown for a swarm run. */
export function buildModelUsageReport(agentRuns: AgentRunDocument[]): SwarmRunModelUsageLine[] {
  const buckets = new Map<string, ModelUsageBucket>();

  for (const run of agentRuns) {
    const usage = extractAgentRunInferenceUsage(run);
    if (!usage) {
      continue;
    }

    const key = modelUsageKey(usage.provider, usage.model);
    const existing = buckets.get(key);
    if (existing) {
      existing.promptTokens += usage.promptTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
      existing.agentRunCount += 1;
    } else {
      buckets.set(key, {
        provider: usage.provider,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        costUsd: null,
        agentRunCount: 1,
      });
    }
  }

  const lines = [...buckets.values()].map((line) => ({
    ...line,
    costUsd: costUsdForLine(line.provider, line.model, line.promptTokens, line.completionTokens),
  }));

  lines.sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
  return lines;
}

/** Rolls up top-level `costUsd` from per-model lines (OpenAI only). */
export function rollupOpenAiCostUsd(lines: SwarmRunModelUsageLine[]): number | null {
  const openAiLines = lines.filter((l) => l.provider === InferenceProviderKind.OPENAI_DIRECT);
  if (openAiLines.length === 0) {
    return null;
  }

  let total = 0;
  for (const line of openAiLines) {
    if (line.costUsd == null) {
      return null;
    }
    total += line.costUsd;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
