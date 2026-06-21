import type { GrokWorkerToolsConfig } from '../types/grok-worker-tools.types';

export function buildGrokResponsesTools(
  config: GrokWorkerToolsConfig,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  if (config.xSearch) {
    const xSearch: Record<string, unknown> = { type: 'x_search' };
    if (config.xSearchAllowedHandles?.length) {
      xSearch.allowed_x_handles = config.xSearchAllowedHandles;
    } else if (config.xSearchExcludedHandles?.length) {
      xSearch.excluded_x_handles = config.xSearchExcludedHandles;
    }
    if (config.xSearchFromDate) {
      xSearch.from_date = config.xSearchFromDate;
    }
    if (config.xSearchToDate) {
      xSearch.to_date = config.xSearchToDate;
    }
    if (config.xSearchEnableImageUnderstanding) {
      xSearch.enable_image_understanding = true;
    }
    if (config.xSearchEnableVideoUnderstanding) {
      xSearch.enable_video_understanding = true;
    }
    tools.push(xSearch);
  }

  if (config.webSearch) {
    tools.push({ type: 'web_search' });
  }

  return tools;
}

export function resolveGrokToolChoice(
  config: GrokWorkerToolsConfig,
): 'auto' | 'required' | 'none' | undefined {
  return config.toolChoice;
}
