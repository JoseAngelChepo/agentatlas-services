import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from '../base/base-agent.tool';
import { FirecrawlService } from '../providers/firecrawl.service';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type { ResearchPaperInput, ResearchPaperOutput } from '../types/research.types';

@Injectable()
export class ResearchPaperTool extends BaseAgentTool<ResearchPaperInput, ResearchPaperOutput> {
  readonly id = ToolId.RESEARCH_PAPER;
  readonly name = 'Research — inspect or read paper';
  readonly description =
    'Inspect paper metadata by id, or pass a question to retrieve the most relevant full-text passages from the paper.';
  readonly promptHints = {
    whenToUse:
      'After finding a paper id — to verify metadata, or to extract specific methods, results, or claims from the full text.',
    inputGuide:
      'Call with `{ "paperId": "arxiv:1706.03762" }` for metadata. Add `"question": "What is the attention mechanism?"` to read passages.',
    outputGuide:
      'Metadata mode: `paper` object. Passages mode: `passages[]` with `text` and `score` plus `paper` metadata.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['paperId'],
    properties: {
      paperId: {
        type: 'string',
        description: 'Canonical paperId or source id, e.g. arxiv:1706.03762',
      },
      question: {
        type: 'string',
        description: 'When set, returns top matching full-text passages for this question',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Passage count when question is set (default 4)',
      },
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
    input: ResearchPaperInput,
    context?: ToolExecutionContext,
  ): Promise<ResearchPaperOutput> {
    this.requireUserId(context);

    return this.firecrawl.researchGetPaper({
      paperId: input.paperId,
      question: input.question,
      limit: input.limit,
    });
  }
}
