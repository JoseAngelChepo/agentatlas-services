import { ToolId } from '../types/tool-id.enum';

export function parseAgentToolIds(raw: unknown): ToolId[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const allowed = new Set(Object.values(ToolId));
  const ids: ToolId[] = [];

  for (const item of raw) {
    if (typeof item === 'string' && allowed.has(item as ToolId)) {
      ids.push(item as ToolId);
    }
  }

  return ids;
}
