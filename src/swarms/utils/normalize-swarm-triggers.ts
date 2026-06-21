const TRIGGER_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Normalizes routing trigger keys (`contact_lookup`, `send_message`, …). */
export function normalizeSwarmTriggers(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const triggers: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const key = item.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !TRIGGER_KEY_RE.test(key) || triggers.includes(key)) {
      continue;
    }
    triggers.push(key);
  }

  return triggers;
}

export function mergeSwarmTriggers(
  declared: string[] | undefined,
  platform: string[],
): string[] {
  const merged = [...normalizeSwarmTriggers(declared ?? [])];
  for (const key of platform) {
    if (!merged.includes(key)) {
      merged.push(key);
    }
  }
  return merged;
}
