import { Types } from 'mongoose';

export function parseSwarmToolIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!Types.ObjectId.isValid(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ids.push(trimmed);
  }

  return ids;
}
