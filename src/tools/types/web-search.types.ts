export type WebSearchInput = {
  query: string;
  limit?: number;
  sources?: Array<'web' | 'news' | 'images'>;
  categories?: Array<'github' | 'research' | 'pdf'>;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  tbs?: string;
};

export type WebSearchResultItem = {
  url: string;
  title: string;
  description: string;
  markdown: string | null;
  category: string | null;
  source: string;
};

export type WebSearchOutput = {
  query: string;
  resultCount: number;
  results: WebSearchResultItem[];
};
