const INLINE_LINK_PATTERN = /!?\[[^\]]*\]\(([^)]+)\)/g;
const AUTO_LINK_PATTERN = /<(https?:\/\/[^>]+)>/g;
const BARE_URL_PATTERN = /(?:^|[\s([{"'])((?:https?:\/\/)[^\s<>[\](){}'"]+)/g;
const REFERENCE_DEF_PATTERN = /^\[[^\]]+\]:\s*(\S+)/gm;

function stripMarkdownLinkTarget(raw: string): string {
  return raw.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, '') ?? '';
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveHttpUrl(href: string, baseUrl: string): string | null {
  const target = stripMarkdownLinkTarget(href);
  if (!target || target.startsWith('#')) {
    return null;
  }

  try {
    const resolved = new URL(target, baseUrl).href;
    return isHttpUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** Extract unique http(s) links from markdown, resolved against the scraped page URL. */
export function extractLinksFromMarkdown(content: string, baseUrl: string): string[] {
  if (!content.trim()) {
    return [];
  }

  const found = new Set<string>();

  for (const match of content.matchAll(INLINE_LINK_PATTERN)) {
    const href = match[1];
    if (!href) continue;
    const resolved = resolveHttpUrl(href, baseUrl);
    if (resolved) {
      found.add(resolved);
    }
  }

  for (const match of content.matchAll(AUTO_LINK_PATTERN)) {
    const href = match[1];
    if (!href) continue;
    const resolved = resolveHttpUrl(href, baseUrl);
    if (resolved) {
      found.add(resolved);
    }
  }

  for (const match of content.matchAll(BARE_URL_PATTERN)) {
    const href = match[1];
    if (!href) continue;
    const resolved = resolveHttpUrl(href, baseUrl);
    if (resolved) {
      found.add(resolved);
    }
  }

  for (const match of content.matchAll(REFERENCE_DEF_PATTERN)) {
    const href = match[1];
    if (!href) continue;
    const resolved = resolveHttpUrl(href, baseUrl);
    if (resolved) {
      found.add(resolved);
    }
  }

  return [...found];
}
