/**
 * Turns raw LLM text into structured worker output for downstream graph edges.
 */
export function parseWorkerLlmOutput(
  text: string,
  options?: { preferJson?: boolean },
): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { result: '' };
  }

  if (options?.preferJson) {
    const parsed = tryParseJsonObject(trimmed);
    if (parsed) {
      return parsed;
    }
  } else {
    const parsed = tryParseJsonObject(trimmed);
    if (parsed) {
      return parsed;
    }
  }

  return {
    result: trimmed,
    text: trimmed,
  };
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const candidates = [text, extractJsonFence(text)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function extractJsonFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}
