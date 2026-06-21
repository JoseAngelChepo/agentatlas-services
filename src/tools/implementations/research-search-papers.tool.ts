import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from '../base/base-agent.tool';
import { FirecrawlService } from '../providers/firecrawl.service';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type {
  ResearchSearchPapersInput,
  ResearchSearchPapersOutput,
} from '../types/research.types';

@Injectable()
export class ResearchSearchPapersTool extends BaseAgentTool<
  ResearchSearchPapersInput,
  ResearchSearchPapersOutput
> {
  readonly id = ToolId.RESEARCH_SEARCH_PAPERS;
  readonly name = 'Research papers';
  readonly description =
    'Search academic papers by topic, method, benchmark, author, or category using the Firecrawl Research Index.';
  readonly promptHints = {
    whenToUse:
      'ALWAYS call when the user asks to search, find, or investigate academic papers, arXiv preprints, benchmarks, or scholarly literature — never tell them to browse arXiv manually.',
    inputGuide:
      'Call with `{ "query": "swarm multi-agent systems arXiv" }`. Optional: `limit`, `authors`, `categories` (e.g. cs.AI, cs.MA), `from`/`to` (YYYY-MM-DD).',
    outputGuide:
      'JSON with `papers[]` (`paperId`, `title`, `abstract`, `authors`, `categories`, `score`). Summarize findings from this result in your reply.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Natural-language paper search query' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max papers (default 10)' },
      authors: { type: 'string', description: 'Author name substring filter' },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paper categories, e.g. cs.LG, cs.CL',
      },
      from: { type: 'string', description: 'Inclusive lower date bound YYYY-MM-DD' },
      to: { type: 'string', description: 'Inclusive upper date bound YYYY-MM-DD' },
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
    input: ResearchSearchPapersInput,
    context?: ToolExecutionContext,
  ): Promise<ResearchSearchPapersOutput> {
    this.requireUserId(context);

    const papers = await this.firecrawl.researchSearchPapers(input);
    return { query: input.query, papers };
  }
}
