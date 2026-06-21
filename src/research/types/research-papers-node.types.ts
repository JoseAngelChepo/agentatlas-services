/** Mirrors workspace research papers node `data` shape. */
export type ResearchPapersQuerySource = 'runInput' | 'upstream' | 'static';

export type ResearchPapersNodeData = {
  label?: string;
  querySource: ResearchPapersQuerySource;
  /** Key under `runInput` or field path under `upstream.*`. */
  queryPath?: string;
  /** Fixed query when `querySource` is `static`. */
  query?: string;
  limit?: number;
};

export const RESEARCH_PAPERS_SUCCESS_HANDLE = 'success';
export const RESEARCH_PAPERS_FAILED_HANDLE = 'failed';

export type ResearchPaperResult = {
  paperId: string;
  title: string;
  abstract: string;
  authors?: string;
  categories?: string[];
  score?: number;
  ids?: Record<string, string[]>;
};

export type ResearchPapersNodeOutput = {
  kind: 'research_papers';
  branchHandle: typeof RESEARCH_PAPERS_SUCCESS_HANDLE | typeof RESEARCH_PAPERS_FAILED_HANDLE;
  query: string;
  status: 'completed' | 'failed';
  papers: ResearchPaperResult[];
  paperCount: number;
  error: string | null;
  latencyMs: number;
};
