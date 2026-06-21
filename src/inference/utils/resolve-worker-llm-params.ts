import type { AgentWorkerModel } from '../../swarms/schemas/agent-worker.schema';

const MAX_TOKENS_CAP = 32_000;

export type WorkerLlmParams = {
  provider: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  jsonMode: boolean;
};

function readNumber(obj: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readBoolean(obj: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const v = obj?.[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Merges per-worker `model.params` with service defaults (env).
 */
export function resolveWorkerLlmParams(
  model: AgentWorkerModel,
  defaults: {
    defaultModel: string;
    defaultTemperature: number;
    defaultMaxTokens?: number;
  },
): WorkerLlmParams {
  const params = (model.params ?? {}) as Record<string, unknown>;

  const resolvedModel =
    (typeof params['model'] === 'string' && params['model'].trim()) ||
    model.name.trim() ||
    defaults.defaultModel;

  const temperature = Math.min(
    2,
    Math.max(
      0,
      readNumber(params, 'temperature') ??
        readNumber(params, 'temp') ??
        defaults.defaultTemperature,
    ),
  );

  const rawMax =
    readNumber(params, 'maxTokens') ??
    readNumber(params, 'max_tokens') ??
    defaults.defaultMaxTokens;

  const maxTokens =
    typeof rawMax === 'number'
      ? Math.min(MAX_TOKENS_CAP, Math.max(1, Math.floor(rawMax)))
      : undefined;

  const jsonMode = readBoolean(params, 'jsonMode') ?? readBoolean(params, 'json_mode') ?? false;

  return {
    provider: model.provider,
    model: resolvedModel,
    temperature,
    maxTokens,
    jsonMode,
  };
}
