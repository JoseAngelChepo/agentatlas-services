const DEFAULT_MAX_STRING_CHARS = 8_000;
const DEFAULT_MAX_TOTAL_JSON_CHARS = 48_000;

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}\n\n[… truncated at ${maxChars} characters]`;
}

function capValue(value: unknown, maxStringChars: number): unknown {
  if (typeof value === 'string') {
    return truncateString(value, maxStringChars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => capValue(item, maxStringChars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = capValue(nested, maxStringChars);
    }
    return out;
  }
  return value;
}

/** Shrink large tool payloads before they are sent back into an LLM tool loop. */
export function capToolResultForModel(
  value: unknown,
  options?: {
    maxStringChars?: number;
    maxTotalJsonChars?: number;
  },
): unknown {
  const maxStringChars = options?.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
  const maxTotalJsonChars = options?.maxTotalJsonChars ?? DEFAULT_MAX_TOTAL_JSON_CHARS;

  let capped = capValue(value, maxStringChars);
  let json = JSON.stringify(capped);
  if (json.length <= maxTotalJsonChars) {
    return capped;
  }

  const tighterMax = Math.max(1_000, Math.floor(maxStringChars / 2));
  capped = capValue(value, tighterMax);
  json = JSON.stringify(capped);
  if (json.length <= maxTotalJsonChars) {
    return capped;
  }

  return {
    truncated: true,
    message:
      'Tool output exceeded model context limits. Retry with a narrower query, lower limit, or use webpage_scrape on a single URL.',
    preview: truncateString(json, maxTotalJsonChars - 256),
  };
}
