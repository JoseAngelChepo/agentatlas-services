import { Injectable } from '@nestjs/common';
import { ScraperService } from '../../scraper/scraper.service';
import { ScrapeRequestSource } from '../../scraper/types/scrape-request-source.enum';
import { BaseAgentTool } from '../base/base-agent.tool';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type {
  WebpageScrapeInput,
  WebpageScrapeOutput,
} from '../types/webpage-scrape.types';
import type { ToolInputSchema } from '../types/tool-input-schema.types';

@Injectable()
export class WebpageScrapeTool extends BaseAgentTool<
  WebpageScrapeInput,
  WebpageScrapeOutput
> {
  readonly id = ToolId.WEBPAGE_SCRAPE;
  readonly name = 'Webpage scrape';
  readonly description =
    'Fetch a webpage with Firecrawl and return its readable content as markdown text inside JSON.';
  readonly promptHints = {
    whenToUse:
      'When the user needs live content from a specific public webpage and provides or implies a URL.',
    inputGuide:
      'Call with `{ "url": "https://..." }`. The URL must be a full public HTTPS address.',
    outputGuide:
      'JSON with `content` (markdown page text), `url`, `format`, and `scrapeRequestId`. Quote or summarize `content` in your reply.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'Full public URL to scrape, including https://',
      },
    },
    additionalProperties: false,
  };

  constructor(private readonly scraperService: ScraperService) {
    super();
  }

  isConfigured(): boolean {
    return this.scraperService.isScrapeConfigured();
  }

  async execute(
    input: WebpageScrapeInput,
    context?: ToolExecutionContext,
  ): Promise<WebpageScrapeOutput> {
    const userId = this.requireUserId(context);

    const result = await this.scraperService.scrapeWebpage(input, {
      userId,
      source: context?.swarmRunId ? ScrapeRequestSource.AGENT : ScrapeRequestSource.API,
      swarmRunId: context?.swarmRunId,
      agentRunId: context?.agentRunId,
    });

    return {
      scrapeRequestId: result.scrapeRequestId,
      url: result.url,
      content: result.content,
      format: result.format,
    };
  }
}
