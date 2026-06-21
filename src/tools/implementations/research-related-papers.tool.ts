import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from '../base/base-agent.tool';
import { FirecrawlService } from '../providers/firecrawl.service';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type {
  ResearchRelatedPapersInput,
  ResearchRelatedPapersOutput,
} from '../types/research.types';

@Injectable()
export class ResearchRelatedPapersTool extends BaseAgentTool<
  ResearchRelatedPapersInput,
  ResearchRelatedPapersOutput
> {
  readonly id = ToolId.RESEARCH_RELATED_PAPERS;
  readonly name = 'Research — related papers';
  readonly description =
    'Expand from seed papers to related work, citers, or references ranked against a research intent.';
  readonly promptHints = {
    whenToUse:
      'When you have a strong seed paper and need similar work, papers that cite it, or its references for a literature review.',
    inputGuide:
      'Call with `{ "paperId": "arxiv:1706.03762", "intent": "efficient transformers" }`. Optional `mode`: similar (default), citers, references.',
    outputGuide: 'JSON with ranked `papers[]` — same shape as research_search_papers results.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['paperId', 'intent'],
    properties: {
      paperId: { type: 'string', description: 'Seed paper id, e.g. arxiv:1706.03762' },
      intent: { type: 'string', description: 'Natural-language research intent to rank candidates' },
      mode: {
        type: 'string',
        enum: ['similar', 'citers', 'references'],
        description: 'Expansion mode (default similar)',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max papers (default 10)' },
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
    input: ResearchRelatedPapersInput,
    context?: ToolExecutionContext,
  ): Promise<ResearchRelatedPapersOutput> {
    this.requireUserId(context);

    const papers = await this.firecrawl.researchRelatedPapers(input);
    return {
      paperId: input.paperId,
      intent: input.intent,
      mode: input.mode ?? 'similar',
      papers,
    };
  }
}
