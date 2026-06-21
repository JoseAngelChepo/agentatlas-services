import { Injectable } from '@nestjs/common';
import { compressMarkdownForModel } from '../../scraper/utils/compress-markdown-for-model';
import { BaseAgentTool } from '../base/base-agent.tool';
import { FirecrawlService } from '../providers/firecrawl.service';
import { ToolId } from '../types/tool-id.enum';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type { WebSearchInput, WebSearchOutput } from '../types/web-search.types';

/** Per-result markdown cap — full arXiv pages can exceed 1M characters. */
const WEB_SEARCH_MARKDOWN_MAX_CHARS = 6_000;

@Injectable()
export class WebSearchTool extends BaseAgentTool<WebSearchInput, WebSearchOutput> {
  readonly id = ToolId.WEB_SEARCH;
  readonly name = 'Web search';
  readonly description =
    'Search the web with Firecrawl and return ranked results with full-page markdown content when available.';
  readonly promptHints = {
    whenToUse:
      'When the user asks a question that needs fresh web sources, news, docs, or you do not have a specific URL yet.',
    inputGuide:
      'Call with `{ "query": "..." }`. Optional: `limit` (1–10), `sources` (web/news/images), `categories` (github/research/pdf), `includeDomains`, `excludeDomains`, `country` (ISO code), `tbs` (e.g. `qdr:w` for past week).',
    outputGuide:
      'JSON with `results[]` (`url`, `title`, `description`, `markdown` excerpt, `category`, `source`). Summarize findings and cite URLs; use `webpage_scrape` when you need a full page.',
  };
  readonly inputSchema: ToolInputSchema = {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language search query',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results (default 5, max 10)',
        minimum: 1,
        maximum: 10,
      },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['web', 'news', 'images'] },
        description: 'Result source types to search',
      },
      categories: {
        type: 'array',
        items: { type: 'string', enum: ['github', 'research', 'pdf'] },
        description: 'Filter to GitHub, academic research, or PDF results',
      },
      includeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only return results from these hostnames',
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude results from these hostnames',
      },
      country: {
        type: 'string',
        description: 'ISO country code for geo-targeted results (e.g. US, DE)',
      },
      tbs: {
        type: 'string',
        description: 'Time filter, e.g. qdr:d (past day), qdr:w (past week), qdr:m (past month)',
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

  async execute(input: WebSearchInput, context?: ToolExecutionContext): Promise<WebSearchOutput> {
    this.requireUserId(context);

    const limit = Math.min(input.limit ?? 5, 10);
    const rawResults = await this.firecrawl.search({
      ...input,
      limit,
    });

    const results = rawResults.slice(0, limit).map((item) => ({
      ...item,
      markdown: item.markdown
        ? compressMarkdownForModel(item.markdown, {
            maxChars: WEB_SEARCH_MARKDOWN_MAX_CHARS,
          }).content
        : null,
    }));

    return {
      query: input.query,
      resultCount: results.length,
      results,
    };
  }
}
