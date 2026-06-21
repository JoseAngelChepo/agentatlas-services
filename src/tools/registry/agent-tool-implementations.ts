import type { Type } from '@nestjs/common';
import type { AgentTool } from '../types/agent-tool.interface';
import { ResearchPaperTool } from '../implementations/research-paper.tool';
import { ResearchRelatedPapersTool } from '../implementations/research-related-papers.tool';
import { ResearchSearchGithubTool } from '../implementations/research-search-github.tool';
import { ResearchSearchPapersTool } from '../implementations/research-search-papers.tool';
import { WebpageScrapeTool } from '../implementations/webpage-scrape.tool';
import { WebSearchTool } from '../implementations/web-search.tool';

/** Concrete agent tool classes — used for late binding when AGENT_TOOLS injection is empty. */
export const AGENT_TOOL_IMPLEMENTATIONS: Array<Type<AgentTool>> = [
  WebpageScrapeTool,
  WebSearchTool,
  ResearchSearchPapersTool,
  ResearchPaperTool,
  ResearchRelatedPapersTool,
  ResearchSearchGithubTool,
];
