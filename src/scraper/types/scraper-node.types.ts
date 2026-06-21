/** Mirrors workspace scraper node `data` shape. */
export type ScraperUrlSource = 'runInput' | 'upstream' | 'static';

export type ScraperNodeData = {
  label?: string;
  urlSource: ScraperUrlSource;
  /** Key under `runInput` or field path under `upstream.*`. */
  urlPath?: string;
  /** Fixed URL when `urlSource` is `static`. */
  url?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
};

export const SCRAPER_SUCCESS_HANDLE = 'success';
export const SCRAPER_FAILED_HANDLE = 'failed';

export type ScraperNodeOutput = {
  kind: 'scraper';
  branchHandle: typeof SCRAPER_SUCCESS_HANDLE | typeof SCRAPER_FAILED_HANDLE;
  scrapeRequestId: string | null;
  url: string;
  status: 'completed' | 'failed';
  content: string | null;
  error: string | null;
  format: 'markdown';
  latencyMs: number;
};
