import type { ScrapeRequestSource } from './scrape-request-source.enum';

export type ScrapeWebpageInput = {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
};

export type ScrapeWebpageContext = {
  userId: string;
  source: ScrapeRequestSource;
  swarmRunId?: string;
  agentRunId?: string;
};

export type ScrapeWebpageResult = {
  scrapeRequestId: string;
  url: string;
  content: string;
  links: string[];
  format: 'markdown';
  status: 'completed';
};
