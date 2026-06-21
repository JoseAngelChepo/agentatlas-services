import { Injectable } from '@nestjs/common';
import { FirecrawlService } from '../tools/providers/firecrawl.service';
import type { FirecrawlResearchPaperSummary } from '../tools/providers/firecrawl.service';

@Injectable()
export class ResearchService {
  constructor(private readonly firecrawl: FirecrawlService) {}

  isConfigured(): boolean {
    return this.firecrawl.isConfigured();
  }

  async searchPapers(
    query: string,
    options?: { limit?: number },
  ): Promise<FirecrawlResearchPaperSummary[]> {
    return this.firecrawl.researchSearchPapers({
      query,
      limit: options?.limit ?? 10,
    });
  }
}
