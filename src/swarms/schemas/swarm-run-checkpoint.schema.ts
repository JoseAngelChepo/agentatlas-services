import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: false })
export class SwarmRunCheckpointDoc {
  @Prop({ type: [String], default: [] })
  completedNodeIds: string[];

  @Prop({ type: [String], default: [] })
  skippedNodeIds: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  visitCount: Record<string, number>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  nodeOutputs: Record<string, Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  workerOutputs: Record<string, Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  shared: Record<string, unknown>;

  @Prop({ type: [Number], default: [] })
  waveMaxDurationsMs: number[];

  @Prop({ type: String, required: true })
  pendingApprovalNodeId: string;

  @Prop({ type: String, default: null })
  pendingNeedsInputNodeId: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  pendingSubSwarm: Record<string, unknown> | null;

  @Prop({ required: true, min: 1 })
  maxVisits: number;

  @Prop({ required: true })
  goal: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  runInput: Record<string, unknown>;
}

export const SwarmRunCheckpointSchema = SchemaFactory.createForClass(SwarmRunCheckpointDoc);
