import { InferenceProviderKind } from '../../inference/types/inference-provider-kind.enum';
import { normalizeInferenceProvider } from '../../inference/utils/normalize-inference-provider';
import type { AgentRunDocument } from '../schemas/agent-run.schema';

export type AgentRunInferenceUsage = {
  provider: InferenceProviderKind;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function readUsageField(
  usage: Record<string, unknown>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return 0;
}

function parseUsage(
  usageRaw: unknown,
): Pick<AgentRunInferenceUsage, 'promptTokens' | 'completionTokens' | 'totalTokens'> {
  if (!usageRaw || typeof usageRaw !== 'object') {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  const usage = usageRaw as Record<string, unknown>;
  const promptTokens = readUsageField(usage, 'promptTokens', 'input_tokens');
  const completionTokens = readUsageField(usage, 'completionTokens', 'output_tokens');
  const totalTokens =
    readUsageField(usage, 'totalTokens', 'total_tokens') ||
    promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/** Reads provider, model, and token usage from a persisted agent run inference trace. */
export function extractAgentRunInferenceUsage(
  run: AgentRunDocument,
): AgentRunInferenceUsage | null {
  const inference = run.inference;
  const response =
    inference?.response && typeof inference.response === 'object'
      ? (inference.response as Record<string, unknown>)
      : null;
  if (!response) {
    return null;
  }

  const request =
    inference?.request && typeof inference.request === 'object'
      ? (inference.request as Record<string, unknown>)
      : null;

  const providerRaw =
    (typeof response.provider === 'string' && response.provider) ||
    (typeof request?.provider === 'string' && request.provider) ||
    '';
  const model =
    (typeof response.model === 'string' && response.model) ||
    (typeof request?.model === 'string' && request.model) ||
    '';

  const { promptTokens, completionTokens, totalTokens } = parseUsage(response.usage);
  if (totalTokens === 0 && promptTokens === 0 && completionTokens === 0) {
    return null;
  }

  return {
    provider: normalizeInferenceProvider(providerRaw),
    model,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}
