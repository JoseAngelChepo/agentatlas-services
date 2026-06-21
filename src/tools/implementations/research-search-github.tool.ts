import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from '../base/base-agent.tool';
import { FirecrawlService } from '../providers/firecrawl.service';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type {
  ResearchSearchGithubInput,
  ResearchSearchGithubOutput,
} from '../types/research.types';

@Injectable()
export class ResearchSearchGithubTool extends BaseAgentTool<
  ResearchSearchGithubInput,
  ResearchSearchGithubOutput
> {
  readonly id = ToolId.RESEARCH_SEARCH_GITHUB;
  readonly name = 'Research — search GitHub';
  readonly description =
    'Search GitHub issues, pull requests, discussions, and READMEs for implementation notes and engineering prior art.';
  readonly promptHints = {
    whenToUse:
      'When you need implementation details, bugs, design discussions, or repo README context for a technical topic.',
    inputGuide: 'Call with `{ "query": "flash attention implementation notes" }`. Optional `limit` (default 10).',
    outputGuide:
      'JSON with `results[]` (`url`, `title`, `snippet`, `repository`, `score`). Cite repos and issues in your answer.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Natural-language GitHub search query' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 10)' },
    },
    additionalProperties: false,
  };

  constructor(private readonly firecrawl: FirecrawlService) {
    super();
  }

  isConfigured(): boolean {
    return this.firecrawl.isConfigured();
  }

  async execute(
    input: ResearchSearchGithubInput,
    context?: ToolExecutionContext,
  ): Promise<ResearchSearchGithubOutput> {
    this.requireUserId(context);

    const results = await this.firecrawl.researchSearchGithub(input);
    return { query: input.query, results };
  }
}
