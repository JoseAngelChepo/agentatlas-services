import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { RunStatus } from '../types/run-status.enum';
import { SwarmRunKind } from '../types/swarm-run-kind.enum';
import { SwarmRunModelUsage, SwarmRunModelUsageSchema } from './swarm-run-model-usage.schema';
import { SwarmRunScrapeUsage, SwarmRunScrapeUsageSchema } from './swarm-run-scrape-usage.schema';
import { SwarmRunCheckpointDoc, SwarmRunCheckpointSchema } from './swarm-run-checkpoint.schema';

export type SwarmRunDocument = HydratedDocument<SwarmRun>;

@Schema({ timestamps: true, collection: 'swarm_runs' })
export class SwarmRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Swarm', required: true, index: true })
  swarmId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  triggeredBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  input: Record<string, unknown>;

  @Prop({ type: String, enum: SwarmRunKind, default: SwarmRunKind.SWARM, index: true })
  runKind: SwarmRunKind;

  /** Parent run when `runKind` is `sub_swarm`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SwarmRun', default: null, index: true })
  parentSwarmRunId: Types.ObjectId | null;

  /** Graph node id in the parent swarm that invoked this sub-run. */
  @Prop({ type: String, default: null })
  parentNodeId: string | null;

  /** Nesting depth: 0 = top-level, 1 = first sub-swarm, … */
  @Prop({ default: 0, min: 0 })
  depth: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  output: Record<string, unknown> | null;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'AgentRun' }],
    default: [],
  })
  agentRuns: Types.ObjectId[];

  @Prop({ type: String, enum: RunStatus, default: RunStatus.IDLE })
  status: RunStatus;

  @Prop({ default: 0, min: 0 })
  durationMs: number;

  @Prop({ default: 0, min: 0 })
  promptTokens: number;

  @Prop({ default: 0, min: 0 })
  completionTokens: number;

  @Prop({ default: 0, min: 0 })
  totalTokens: number;

  /** Estimated OpenAI list-price USD; null when not applicable or unknown models. */
  @Prop({ type: Number, default: null })
  costUsd: number | null;

  /** Browser scraping cost ($0.09/hr, measured or ~2.5s default per request). */
  @Prop({ default: 0, min: 0 })
  scrapeCostUsd: number;

  /** `costUsd` (LLM) + `scrapeCostUsd`; LLM unknowns count as 0 in the sum. */
  @Prop({ default: 0, min: 0 })
  totalCostUsd: number;

  /** Per provider+model token and cost breakdown (internal run report). */
  @Prop({ type: [SwarmRunModelUsageSchema], default: [] })
  usageByModel: SwarmRunModelUsage[];

  @Prop({ type: SwarmRunScrapeUsageSchema, default: () => ({ requests: [] }) })
  scrapeUsage: SwarmRunScrapeUsage;

  @Prop({ default: '' })
  failureReason: string;

  /** Active human-approval gate (while status is `awaiting_approval`). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SwarmRunApproval', default: null })
  pendingApprovalId: Types.ObjectId | null;

  /** External id for a paused user-input node (while status is `awaiting_input`). */
  @Prop({ type: String, default: null, index: true })
  pendingNeedsInputId: string | null;

  @Prop({ type: SwarmRunCheckpointSchema, default: null })
  checkpoint: SwarmRunCheckpointDoc | null;
}

export const SwarmRunSchema = SchemaFactory.createForClass(SwarmRun);

SwarmRunSchema.index({ swarmId: 1, createdAt: -1 });
SwarmRunSchema.index({ triggeredBy: 1, swarmId: 1, runKind: 1, createdAt: -1 });
