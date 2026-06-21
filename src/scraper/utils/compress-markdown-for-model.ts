export type CompressMarkdownForModelOptions = {
  /** Hard character cap after compression (0 = unlimited). */
  maxChars?: number;
};

export type CompressMarkdownForModelResult = {
  content: string;
  originalChars: number;
  compressedChars: number;
};

const FENCED_CODE_BLOCK_PATTERN = /(```[\s\S]*?```)/g;

function collapseInlineSpaces(line: string): string {
  return line.replace(/[^\S\n]{2,}/g, ' ');
}

function isDecorativeImageLine(line: string): boolean {
  const match = line.match(/^\s*!\[([^\]]*)\]\([^)]+\)\s*$/);
  if (!match) {
    return false;
  }
  return (match[1] ?? '').trim().length === 0;
}

function compressSegment(segment: string): string {
  return segment
    .split('\n')
    .map((line) => collapseInlineSpaces(line.trimEnd()))
    .filter((line) => !isDecorativeImageLine(line))
    .join('\n');
}

/** Apply transforms only outside fenced ``` code blocks. */
function processOutsideCodeFences(content: string, transform: (segment: string) => string): string {
  const parts = content.split(FENCED_CODE_BLOCK_PATTERN);
  return parts
    .map((part, index) => (index % 2 === 0 ? transform(part) : part))
    .join('');
}

/**
 * Lossless-ish cleanup of scraped markdown before sending it to an LLM:
 * fewer blank lines, trimmed lines, collapsed whitespace, no decorative images.
 */
export function compressMarkdownForModel(
  content: string,
  options?: CompressMarkdownForModelOptions,
): CompressMarkdownForModelResult {
  const originalChars = content.length;
  if (!content.trim()) {
    return { content: '', originalChars, compressedChars: 0 };
  }

  let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = processOutsideCodeFences(text, compressSegment);
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const maxChars = options?.maxChars ?? 0;
  if (maxChars > 0 && text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}\n\n[… content truncated at ${maxChars} characters]`;
  }

  return {
    content: text,
    originalChars,
    compressedChars: text.length,
  };
}
