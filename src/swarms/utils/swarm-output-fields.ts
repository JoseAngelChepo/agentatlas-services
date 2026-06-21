const SCRAPER_KEYS = ['content', 'url', 'status'] as const;
const RESEARCH_PAPERS_KEYS = ['query', 'papers', 'paperCount', 'status'] as const;

/** Flat keys and `compressOutput` wrapper `{ summary: { …fields } }`. */
export function readTopLevelOutputField(
  output: Record<string, unknown>,
  key: string,
): unknown {
  if (key in output) {
    return output[key];
  }
  const wrapped = output.summary;
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return (wrapped as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Indexes top-level output fields into `into` (first writer wins). */
export function indexOutputFields(
  payload: Record<string, unknown>,
  into: Record<string, Record<string, unknown>>,
): void {
  const isScraper = payload.kind === 'scraper';
  const isResearchPapers = payload.kind === 'research_papers';
  const keys = isScraper
    ? SCRAPER_KEYS
    : isResearchPapers
      ? RESEARCH_PAPERS_KEYS
      : Object.keys(payload);

  for (const key of keys) {
    if (key === 'kind') {
      continue;
    }
    if (key in into) {
      continue;
    }
    if (readTopLevelOutputField(payload, key) !== undefined) {
      into[key] = payload;
    }
  }
}
