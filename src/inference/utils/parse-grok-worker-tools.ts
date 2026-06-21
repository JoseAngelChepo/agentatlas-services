import type { GrokWorkerToolsConfig } from '../types/grok-worker-tools.types';

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((v) => (typeof v === 'string' ? v.trim().replace(/^@/, '') : ''))
    .filter((v) => v.length > 0);
  return items.length > 0 ? items.slice(0, 20) : undefined;
}

function asIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export function parseGrokWorkerTools(raw: unknown): GrokWorkerToolsConfig {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const toolChoice = o.toolChoice ?? o.tool_choice;

  return {
    xSearch: o.xSearch === true || o.x_search === true,
    xSearchAllowedHandles: asStringArray(
      o.xSearchAllowedHandles ?? o.x_search_allowed_handles ?? o.allowed_x_handles,
    ),
    xSearchExcludedHandles: asStringArray(
      o.xSearchExcludedHandles ?? o.x_search_excluded_handles ?? o.excluded_x_handles,
    ),
    xSearchFromDate: asIsoDate(o.xSearchFromDate ?? o.x_search_from_date ?? o.from_date),
    xSearchToDate: asIsoDate(o.xSearchToDate ?? o.x_search_to_date ?? o.to_date),
    xSearchEnableImageUnderstanding:
      o.xSearchEnableImageUnderstanding === true ||
      o.x_search_enable_image_understanding === true ||
      o.enable_image_understanding === true,
    xSearchEnableVideoUnderstanding:
      o.xSearchEnableVideoUnderstanding === true ||
      o.x_search_enable_video_understanding === true ||
      o.enable_video_understanding === true,
    webSearch: o.webSearch === true || o.web_search === true,
    toolChoice:
      toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none'
        ? toolChoice
        : undefined,
  };
}

export function hasGrokWorkerTools(config: GrokWorkerToolsConfig): boolean {
  return config.xSearch === true || config.webSearch === true;
}
