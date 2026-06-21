import type { OpenAiWorkerToolsConfig } from '../types/openai-worker-tools.types';

export function buildOpenAiResponsesTools(
  config: OpenAiWorkerToolsConfig,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  if (config.webSearch) {
    const webSearch: Record<string, unknown> = { type: 'web_search' };
    if (config.webSearchContextSize) {
      webSearch.search_context_size = config.webSearchContextSize;
    }
    if (config.webSearchAllowedDomains?.length) {
      webSearch.filters = {
        allowed_domains: config.webSearchAllowedDomains.map((d) =>
          d.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        ),
      };
    }
    tools.push(webSearch);
  }

  for (const fn of config.functions ?? []) {
    tools.push({
      type: 'function',
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      ...(fn.parameters ? { parameters: fn.parameters } : {}),
      ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
    });
  }

  for (const hosted of config.hosted ?? []) {
    if (hosted.type) {
      tools.push({ ...hosted });
    }
  }

  return tools;
}

export function resolveOpenAiToolChoice(
  config: OpenAiWorkerToolsConfig,
): 'auto' | 'required' | 'none' | undefined {
  return config.toolChoice;
}
