import type {
  OpenAiFunctionToolDefinition,
  OpenAiWorkerToolsConfig,
} from '../types/openai-worker-tools.types';

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function parseFunctions(value: unknown): OpenAiFunctionToolDefinition[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const functions: OpenAiFunctionToolDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      continue;
    }
    functions.push({
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      parameters:
        row.parameters && typeof row.parameters === 'object'
          ? (row.parameters as Record<string, unknown>)
          : undefined,
      strict: row.strict === true,
    });
  }
  return functions.length > 0 ? functions : undefined;
}

export function parseOpenAiWorkerTools(raw: unknown): OpenAiWorkerToolsConfig {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const contextSize = o.webSearchContextSize ?? o.web_search_context_size;
  const toolChoice = o.toolChoice ?? o.tool_choice;

  return {
    webSearch: o.webSearch === true || o.web_search === true,
    webSearchContextSize:
      contextSize === 'low' || contextSize === 'medium' || contextSize === 'high'
        ? contextSize
        : undefined,
    webSearchAllowedDomains: asStringArray(
      o.webSearchAllowedDomains ?? o.web_search_allowed_domains,
    ),
    toolChoice:
      toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none'
        ? toolChoice
        : undefined,
    functions: parseFunctions(o.functions),
    hosted: Array.isArray(o.hosted)
      ? o.hosted.filter((h): h is Record<string, unknown> => h != null && typeof h === 'object')
      : undefined,
  };
}

export function hasOpenAiWorkerTools(config: OpenAiWorkerToolsConfig): boolean {
  return (
    config.webSearch === true ||
    (config.functions?.length ?? 0) > 0 ||
    (config.hosted?.length ?? 0) > 0
  );
}
