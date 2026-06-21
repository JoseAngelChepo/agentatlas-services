export type WebpageScrapeInput = {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
};

export type WebpageScrapeOutput = {
  scrapeRequestId: string;
  url: string;
  content: string;
  format: 'markdown';
};
