import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class SwarmRunScrapeRequestLine {
  @Prop({ required: true })
  scrapeRequestId: string;

  @Prop({ required: true })
  url: string;

  @Prop({ default: 0, min: 0 })
  latencyMs: number;

  @Prop({ default: 0, min: 0 })
  costUsd: number;

  @Prop({ required: true })
  status: string;
}

export const SwarmRunScrapeRequestLineSchema =
  SchemaFactory.createForClass(SwarmRunScrapeRequestLine);

@Schema({ _id: false })
export class SwarmRunScrapeUsage {
  @Prop({ default: 0, min: 0 })
  requestCount: number;

  @Prop({ default: 0, min: 0 })
  browserDurationMs: number;

  @Prop({ default: 0, min: 0 })
  costUsd: number;

  @Prop({ type: [SwarmRunScrapeRequestLineSchema], default: [] })
  requests: SwarmRunScrapeRequestLine[];
}

export const SwarmRunScrapeUsageSchema = SchemaFactory.createForClass(SwarmRunScrapeUsage);
