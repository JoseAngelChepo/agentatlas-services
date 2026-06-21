import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ScrapeRequestSource } from '../types/scrape-request-source.enum';
import { ScrapeRequestStatus } from '../types/scrape-request-status.enum';

export type ScrapeRequestDocument = HydratedDocument<ScrapeRequest>;

@Schema({ timestamps: true, collection: 'scrape_requests' })
export class ScrapeRequest {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  url: string;

  @Prop({ type: String, enum: ScrapeRequestStatus, default: ScrapeRequestStatus.PENDING })
  status: ScrapeRequestStatus;

  /** Raw markdown returned by Firecrawl scrape. */
  @Prop({ type: String, default: null })
  rawContent: string | null;

  /** Token-reduced markdown derived from `rawContent` for agent/model reuse. */
  @Prop({ type: String, default: null })
  compressedContent: string | null;

  /** http(s) links extracted from `rawContent` after a successful scrape. */
  @Prop({ type: [String], default: [] })
  links: string[];

  @Prop({ default: 'markdown' })
  format: string;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: String, enum: ScrapeRequestSource, required: true })
  source: ScrapeRequestSource;

  @Prop({ type: String, default: null })
  waitUntil: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SwarmRun', default: null })
  swarmRunId: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'AgentRun', default: null })
  agentRunId: Types.ObjectId | null;

  @Prop({ default: 0, min: 0 })
  latencyMs: number;
}

export const ScrapeRequestSchema = SchemaFactory.createForClass(ScrapeRequest);

ScrapeRequestSchema.index({ userId: 1, createdAt: -1 });
ScrapeRequestSchema.index({ userId: 1, url: 1, createdAt: -1 });
ScrapeRequestSchema.index({ swarmRunId: 1, createdAt: 1 });
