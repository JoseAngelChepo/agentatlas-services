import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FirecrawlErrorResponse = {
  success?: boolean;
  error?: string;
  code?: string;
};

type FirecrawlScrapeResponse = FirecrawlErrorResponse & {
  data?: {
    markdown?: string;
    links?: string[];
  };
};

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  category?: string;
};

type FirecrawlSearchResponse = FirecrawlErrorResponse & {
  data?: Record<string, FirecrawlSearchResult[]>;
};

export type FirecrawlScrapeOptions = {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
};

export type FirecrawlWebSearchInput = {
  query: string;
  limit?: number;
  sources?: Array<'web' | 'news' | 'images'>;
  categories?: Array<'github' | 'research' | 'pdf'>;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  tbs?: string;
};

export type FirecrawlWebSearchResult = {
  url: string;
  title: string;
  description: string;
  markdown: string | null;
  category: string | null;
  source: string;
};

export type FirecrawlResearchPaperSummary = {
  paperId: string;
  title: string;
  abstract: string;
  authors?: string;
  categories?: string[];
  score?: number;
  ids?: Record<string, string[]>;
};

export type FirecrawlResearchPassage = {
  text: string;
  score: number;
};

export type FirecrawlResearchGithubResult = {
  url: string;
  title: string;
  snippet: string;
  repository?: string;
  score?: number;
};

@Injectable()
export class FirecrawlService implements OnModuleInit {
  private readonly logger = new Logger(FirecrawlService.name);
  private readonly baseUrl = 'https://api.firecrawl.dev/v2';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.isConfigured()) {
      this.logger.log('Firecrawl ready (FIRECRAWL_API_KEY loaded)');
      return;
    }

    this.logger.warn(
      'Firecrawl tools disabled — set FIRECRAWL_API_KEY in .env and restart the server',
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey());
  }

  apiKey(): string | undefined {
    return this.config.get<string>('FIRECRAWL_API_KEY', '').trim() || undefined;
  }

  timeoutMs(): number {
    const raw = Number(this.config.get<string>('FIRECRAWL_TIMEOUT_MS', '60000'));
    return Math.min(Math.max(Number.isFinite(raw) ? raw : 60_000, 5_000), 300_000);
  }

  async scrapeUrl(
    url: string,
    options?: FirecrawlScrapeOptions,
  ): Promise<{ markdown: string; links: string[] }> {
    const body: Record<string, unknown> = {
      url,
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      timeout: this.timeoutMs(),
    };

    const waitFor = this.mapWaitUntilToMs(options?.waitUntil);
    if (waitFor > 0) {
      body.waitFor = waitFor;
    }

    const payload = await this.post<FirecrawlScrapeResponse>('/scrape', body, 'scrape');
    const markdown = payload.data?.markdown?.trim();
    if (!markdown) {
      throw new BadGatewayException('Firecrawl returned an empty markdown result');
    }

    return {
      markdown,
      links: payload.data?.links ?? [],
    };
  }

  async search(input: FirecrawlWebSearchInput): Promise<FirecrawlWebSearchResult[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      limit: input.limit ?? 5,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    };

    if (input.sources?.length) {
      body.sources = input.sources.map((type) => ({ type }));
    }
    if (input.categories?.length) {
      body.categories = input.categories.map((type) => ({ type }));
    }
    if (input.includeDomains?.length) {
      body.includeDomains = input.includeDomains;
    }
    if (input.excludeDomains?.length) {
      body.excludeDomains = input.excludeDomains;
    }
    if (input.country) {
      body.country = input.country;
    }
    if (input.tbs) {
      body.tbs = input.tbs;
    }

    const payload = await this.post<FirecrawlSearchResponse>('/search', body, 'search');
    return this.flattenSearchResults(payload.data ?? {});
  }

  async researchSearchPapers(params: {
    query: string;
    limit?: number;
    authors?: string;
    categories?: string[];
    from?: string;
    to?: string;
  }): Promise<FirecrawlResearchPaperSummary[]> {
    const query = new URLSearchParams({
      query: params.query,
      k: String(params.limit ?? 10),
    });
    if (params.authors) query.set('authors', params.authors);
    if (params.categories?.length) query.set('categories', params.categories.join(','));
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);

    const payload = await this.get<{
      results?: FirecrawlResearchPaperSummary[];
      papers?: FirecrawlResearchPaperSummary[];
    }>(
      `/search/research/papers?${query.toString()}`,
      'research search papers',
    );
    return payload.results ?? payload.papers ?? [];
  }

  async researchGetPaper(params: {
    paperId: string;
    question?: string;
    limit?: number;
  }): Promise<
    | { mode: 'metadata'; paper: Record<string, unknown> }
    | {
        mode: 'passages';
        paper: Record<string, unknown>;
        paperId: string;
        query: string;
        passages: FirecrawlResearchPassage[];
      }
  > {
    const query = new URLSearchParams();
    if (params.question?.trim()) {
      query.set('query', params.question.trim());
      query.set('k', String(params.limit ?? 4));
    }

    const suffix = query.size ? `?${query.toString()}` : '';
    const payload = await this.get<Record<string, unknown>>(
      `/search/research/papers/${encodeURIComponent(params.paperId)}${suffix}`,
      'research get paper',
    );

    if (Array.isArray(payload.passages)) {
      return {
        mode: 'passages',
        paper: (payload.paper as Record<string, unknown>) ?? {},
        paperId: String(payload.paperId ?? params.paperId),
        query: String(payload.query ?? params.question ?? ''),
        passages: payload.passages as FirecrawlResearchPassage[],
      };
    }

    return {
      mode: 'metadata',
      paper: (payload.paper as Record<string, unknown>) ?? payload,
    };
  }

  async researchRelatedPapers(params: {
    paperId: string;
    intent: string;
    mode?: 'similar' | 'citers' | 'references';
    limit?: number;
  }): Promise<FirecrawlResearchPaperSummary[]> {
    const query = new URLSearchParams({
      intent: params.intent,
      mode: params.mode ?? 'similar',
      k: String(params.limit ?? 10),
    });

    const payload = await this.get<{
      results?: FirecrawlResearchPaperSummary[];
      papers?: FirecrawlResearchPaperSummary[];
    }>(
      `/search/research/papers/${encodeURIComponent(params.paperId)}/similar?${query.toString()}`,
      'research related papers',
    );
    return payload.results ?? payload.papers ?? [];
  }

  async researchSearchGithub(params: {
    query: string;
    limit?: number;
  }): Promise<FirecrawlResearchGithubResult[]> {
    const query = new URLSearchParams({
      query: params.query,
      k: String(params.limit ?? 10),
    });

    const payload = await this.get<{ results?: FirecrawlResearchGithubResult[] }>(
      `/search/research/github?${query.toString()}`,
      'research search github',
    );
    return payload.results ?? [];
  }

  private mapWaitUntilToMs(
    waitUntil?: FirecrawlScrapeOptions['waitUntil'],
  ): number {
    switch (waitUntil) {
      case 'domcontentloaded':
        return 1_000;
      case 'load':
        return 2_000;
      case 'networkidle2':
        return 3_000;
      case 'networkidle0':
        return 5_000;
      default:
        return 0;
    }
  }

  private flattenSearchResults(
    data: Record<string, FirecrawlSearchResult[]>,
  ): FirecrawlWebSearchResult[] {
    const results: FirecrawlWebSearchResult[] = [];
    for (const [source, items] of Object.entries(data)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item.url) continue;
        results.push({
          url: item.url,
          title: item.title ?? '',
          description: item.description ?? '',
          markdown: item.markdown ?? null,
          category: item.category ?? null,
          source,
        });
      }
    }
    return results;
  }

  private async post<T>(path: string, body: unknown, label: string): Promise<T> {
    return this.request<T>('POST', path, { body, label });
  }

  private async get<T>(path: string, label: string): Promise<T> {
    return this.request<T>('GET', path, { label });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; label: string },
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Firecrawl is not configured. Set FIRECRAWL_API_KEY.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    const started = Date.now();
    const endpoint = `${this.baseUrl}${path}`;

    this.logger.log(`[Firecrawl] ${method} ${path}`);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const payload = (await response.json()) as T & FirecrawlErrorResponse;

      if (!response.ok || payload.success === false) {
        this.logger.warn(
          `[Firecrawl] ${method} ${path} status=${response.status} latencyMs=${Date.now() - started} body=${this.previewForLog(payload)}`,
        );
        throw new BadGatewayException(this.formatApiFailure(response.status, payload, options.label));
      }

      this.logger.log(
        `[Firecrawl] ${method} ${path} ok status=${response.status} latencyMs=${Date.now() - started}`,
      );

      return payload;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException(`Firecrawl ${options.label} timed out after ${this.timeoutMs()}ms`);
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Firecrawl ${options.label} error: ${message}`);
      throw new BadGatewayException(`Firecrawl ${options.label} request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatApiFailure(
    status: number,
    payload: FirecrawlErrorResponse,
    label: string,
  ): string {
    const message = payload.error?.trim();

    if (status === 401 || status === 403) {
      return [
        `Firecrawl ${label} authentication failed.`,
        'Verify FIRECRAWL_API_KEY.',
        message ? `Firecrawl: ${message}` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
    }

    if (status === 402) {
      return message || 'Firecrawl payment required — check your plan and credit balance.';
    }

    if (status === 429) {
      return message || 'Firecrawl rate limit exceeded. Wait and retry.';
    }

    return message || `Firecrawl ${label} request failed (${status})`;
  }

  private previewForLog(value: unknown, maxChars = 200): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}… (${text.length} chars total)`;
  }
}
