import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { RunStatus } from '../types/run-status.enum';

export type AgentRunDocument = HydratedDocument<AgentRun>;

export enum AgentRunMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Schema({ _id: false })
export class AgentRunMessage {
  @Prop({ type: String, enum: AgentRunMessageRole, required: true })
  role: AgentRunMessageRole;

  @Prop({ required: true })
  content: string;

  @Prop({ default: 0, min: 0 })
  tokensUsed: number;

  @Prop({ default: () => new Date() })
  timestamp: Date;
}

export const AgentRunMessageSchema = SchemaFactory.createForClass(AgentRunMessage);

@Schema({ _id: false })
export class AgentRunInferenceTrace {
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  request: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  response: Record<string, unknown> | null;
}

export const AgentRunInferenceTraceSchema = SchemaFactory.createForClass(AgentRunInferenceTrace);

@Schema({ timestamps: true, collection: 'agent_runs' })
export class AgentRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'AgentWorker', required: true, index: true })
  workerId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SwarmRun', required: true, index: true })
  swarmRunId: Types.ObjectId;

  @Prop({ type: [AgentRunMessageSchema], default: [] })
  messages: AgentRunMessage[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  input: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  output: Record<string, unknown> | null;

  @Prop({ type: AgentRunInferenceTraceSchema, default: () => ({ request: null, response: null }) })
  inference: AgentRunInferenceTrace;

  @Prop({ type: String, enum: RunStatus, default: RunStatus.IDLE })
  status: RunStatus;

  @Prop({ default: 0, min: 0 })
  durationMs: number;

  @Prop({ default: 0, min: 0 })
  attempt: number;
}

export const AgentRunSchema = SchemaFactory.createForClass(AgentRun);

AgentRunSchema.index({ swarmRunId: 1, workerId: 1 });
