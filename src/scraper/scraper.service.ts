import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { CloudflareBrowserRunService } from '../tools/providers/cloudflare-browser-run.service';
import type { ListScrapeRequestsQueryDto } from './dto/list-scrape-requests-query.dto';
import { ScrapeRequest, ScrapeRequestDocument } from './schemas/scrape-request.schema';
import { ScrapeRequestStatus } from './types/scrape-request-status.enum';
import type {
  ScrapeWebpageContext,
  ScrapeWebpageInput,
  ScrapeWebpageResult,
} from './types/scrape-webpage.types';
import { compressMarkdownForModel } from './utils/compress-markdown-for-model';
import { extractLinksFromMarkdown } from './utils/extract-links-from-markdown';

/** Reuse a completed scrape for the same URL when younger than this. */
const SCRAPE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ScrapeRequestListResult = {
  items: ScrapeRequestDocument[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class ScraperService {
  constructor(
    @InjectModel(ScrapeRequest.name)
    private readonly scrapeRequestModel: Model<ScrapeRequestDocument>,
    private readonly browserRun: CloudflareBrowserRunService,
    private readonly config: ConfigService,
  ) {}

  private contentMaxChars(): number {
    const raw = Number(this.config.get<string>('SCRAPE_CONTENT_MAX_CHARS', '0'));
    if (!Number.isFinite(raw) || raw <= 0) {
      return 0;
    }
    return Math.floor(raw);
  }

  private compressRawContent(raw: string): string {
    return compressMarkdownForModel(raw, { maxChars: this.contentMaxChars() }).content;
  }

  /** Backfill legacy rows that only have `rawContent`. */
  private async ensureCompressedContent(record: ScrapeRequestDocument): Promise<string> {
    if (record.compressedContent) {
      return record.compressedContent;
    }

    const raw = record.rawContent ?? '';
    const compressed = this.compressRawContent(raw);
    record.compressedContent = compressed;
    await record.save();
    return compressed;
  }

  isBrowserRunConfigured(): boolean {
    return this.browserRun.isConfigured();
  }

  async scrapeWebpage(
    input: ScrapeWebpageInput,
    context: ScrapeWebpageContext,
  ): Promise<ScrapeWebpageResult> {
    const ownCached = await this.findFreshCachedScrapeForUser(context.userId, input.url);
    if (ownCached?.rawContent) {
      await this.ensureCompressedContent(ownCached);
      return this.toScrapeWebpageResult(ownCached);
    }

    const sharedCached = await this.findFreshCachedScrapeFromOtherUsers(
      context.userId,
      input.url,
    );
    if (sharedCached?.rawContent) {
      await this.ensureCompressedContent(sharedCached);
      const copy = await this.createScrapeCopyFrom(sharedCached, input, context);
      return this.toScrapeWebpageResult(copy);
    }

    const record = await this.scrapeRequestModel.create({
      userId: new Types.ObjectId(context.userId),
      url: input.url,
      status: ScrapeRequestStatus.RUNNING,
      source: context.source,
      waitUntil: input.waitUntil ?? null,
      swarmRunId: context.swarmRunId ? new Types.ObjectId(context.swarmRunId) : null,
      agentRunId: context.agentRunId ? new Types.ObjectId(context.agentRunId) : null,
    });

    const started = Date.now();

    try {
      const content = await this.browserRun.fetchMarkdown(input.url, {
        waitUntil: input.waitUntil,
      });
      const latencyMs = Date.now() - started;

      const links = extractLinksFromMarkdown(content, input.url);
      const compressedContent = this.compressRawContent(content);

      record.status = ScrapeRequestStatus.COMPLETED;
      record.rawContent = content;
      record.compressedContent = compressedContent;
      record.links = links;
      record.latencyMs = latencyMs;
      record.error = null;
      await record.save();

      return this.toScrapeWebpageResult(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scrape failed';
      record.status = ScrapeRequestStatus.FAILED;
      record.error = message;
      record.latencyMs = Date.now() - started;
      await record.save();
      throw err;
    }
  }

  private freshScrapeCacheFilter(url: string): FilterQuery<ScrapeRequestDocument> {
    return {
      url,
      status: ScrapeRequestStatus.COMPLETED,
      rawContent: { $ne: null },
      updatedAt: { $gte: new Date(Date.now() - SCRAPE_CACHE_MAX_AGE_MS) },
    };
  }

  private async findFreshCachedScrapeForUser(
    userId: string,
    url: string,
  ): Promise<ScrapeRequestDocument | null> {
    return this.scrapeRequestModel
      .findOne({
        ...this.freshScrapeCacheFilter(url),
        userId: new Types.ObjectId(userId),
      })
      .sort({ updatedAt: -1 })
      .exec();
  }

  private async findFreshCachedScrapeFromOtherUsers(
    userId: string,
    url: string,
  ): Promise<ScrapeRequestDocument | null> {
    return this.scrapeRequestModel
      .findOne({
        ...this.freshScrapeCacheFilter(url),
        userId: { $ne: new Types.ObjectId(userId) },
      })
      .sort({ updatedAt: -1 })
      .exec();
  }

  private async createScrapeCopyFrom(
    source: ScrapeRequestDocument,
    input: ScrapeWebpageInput,
    context: ScrapeWebpageContext,
  ): Promise<ScrapeRequestDocument> {
    return this.scrapeRequestModel.create({
      userId: new Types.ObjectId(context.userId),
      url: source.url,
      status: ScrapeRequestStatus.COMPLETED,
      rawContent: source.rawContent,
      compressedContent: source.compressedContent,
      links: source.links ?? [],
      format: source.format ?? 'markdown',
      error: null,
      source: context.source,
      waitUntil: input.waitUntil ?? null,
      swarmRunId: context.swarmRunId ? new Types.ObjectId(context.swarmRunId) : null,
      agentRunId: context.agentRunId ? new Types.ObjectId(context.agentRunId) : null,
      latencyMs: 0,
    });
  }

  private toScrapeWebpageResult(record: ScrapeRequestDocument): ScrapeWebpageResult {
    const content =
      record.compressedContent ??
      this.compressRawContent(record.rawContent ?? '');

    return {
      scrapeRequestId: record.id,
      url: record.url,
      content,
      links: record.links ?? [],
      format: 'markdown',
      status: 'completed',
    };
  }

  async findBySwarmRun(swarmRunId: Types.ObjectId): Promise<ScrapeRequestDocument[]> {
    return this.scrapeRequestModel
      .find({ swarmRunId })
      .sort({ createdAt: 1 })
      .exec();
  }

  async findByIdForUser(userId: string, id: string): Promise<ScrapeRequestDocument> {
    const doc = await this.scrapeRequestModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Scrape request not found');
    }
    if (doc.userId.toString() !== userId) {
      throw new NotFoundException('Scrape request not found');
    }
    return doc;
  }

  async findAllForUser(
    userId: string,
    query: ListScrapeRequestsQueryDto,
  ): Promise<ScrapeRequestListResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ScrapeRequestDocument> = {
      userId: new Types.ObjectId(userId),
    };

    if (query.url) {
      filter.url = query.url;
    }

    if (query.status) {
      filter.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.scrapeRequestModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.scrapeRequestModel.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }
}
