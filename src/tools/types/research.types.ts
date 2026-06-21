export type ResearchSearchPapersInput = {
  query: string;
  limit?: number;
  authors?: string;
  categories?: string[];
  from?: string;
  to?: string;
};

export type ResearchSearchPapersOutput = {
  query: string;
  papers: Array<{
    paperId: string;
    title: string;
    abstract: string;
    authors?: string;
    categories?: string[];
    score?: number;
    ids?: Record<string, string[]>;
  }>;
};

export type ResearchPaperInput = {
  paperId: string;
  question?: string;
  limit?: number;
};

export type ResearchPaperOutput =
  | {
      mode: 'metadata';
      paper: Record<string, unknown>;
    }
  | {
      mode: 'passages';
      paper: Record<string, unknown>;
      paperId: string;
      query: string;
      passages: Array<{ text: string; score: number }>;
    };

export type ResearchRelatedPapersInput = {
  paperId: string;
  intent: string;
  mode?: 'similar' | 'citers' | 'references';
  limit?: number;
};

export type ResearchRelatedPapersOutput = {
  paperId: string;
  intent: string;
  mode: 'similar' | 'citers' | 'references';
  papers: ResearchSearchPapersOutput['papers'];
};

export type ResearchSearchGithubInput = {
  query: string;
  limit?: number;
};

export type ResearchSearchGithubOutput = {
  query: string;
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    repository?: string;
    score?: number;
  }>;
};
