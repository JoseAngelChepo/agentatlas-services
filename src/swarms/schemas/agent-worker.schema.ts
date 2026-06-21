import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentWorkerDocument = HydratedDocument<AgentWorker>;

@Schema({ _id: false })
export class AgentWorkerModel {
  @Prop({ required: true, trim: true })
  provider: string;

  @Prop({ required: true, trim: true })
  name: string;

  /** Deprecated metadata — not used at inference time. Kept for backwards compatibility. */
  @Prop({ min: 1 })
  contextWindow?: number;

  /**
   * Provider-specific generation params (temperature, maxTokens, jsonMode, model override, …).
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  params: Record<string, unknown>;
}

export const AgentWorkerModelSchema = SchemaFactory.createForClass(AgentWorkerModel);

@Schema({ _id: false })
export class AgentWorkerPromptMessage {
  @Prop({ type: String, enum: ['system', 'user'], required: true })
  role: 'system' | 'user';

  @Prop({ required: true })
  content: string;
}

export const AgentWorkerPromptMessageSchema =
  SchemaFactory.createForClass(AgentWorkerPromptMessage);

/**
 * Reusable agent blueprint: model, prompts, and I/O contracts.
 * Graph wiring (inputs/outputs between workers) lives on {@link SwarmGraph}, not here.
 */
@Schema({ timestamps: true, collection: 'agent_workers' })
export class AgentWorker {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ type: AgentWorkerModelSchema, required: true })
  model: AgentWorkerModel;

  @Prop({ required: true })
  systemPrompt: string;

  /** Extra ordered messages (`system` | `user`) appended after `systemPrompt` (Instructions). */
  @Prop({ type: [AgentWorkerPromptMessageSchema], default: [] })
  promptMessages: AgentWorkerPromptMessage[];

  /**
   * Fields allowed from upstream outputs when `compressOutput=true`.
   * Empty means use default projection keys.
   */
  @Prop({ type: [String], default: [] })
  upstreamFields: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  inputSchema: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  outputSchema: Record<string, unknown>;

  /**
   * OpenAI Responses API tools (`web_search`, custom functions, hosted tools).
   * Only applied for `openai_direct` against api.openai.com.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  openaiTools: Record<string, unknown>;

  /**
   * xAI Responses API tools (`x_search`, `web_search`). Only applied for `grok_direct`.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  grokTools: Record<string, unknown>;

  /**
   * Platform tools the worker may invoke via OpenAI function calling
   * (e.g. `webpage_scrape` for Cloudflare Browser Run).
   */
  @Prop({ type: [String], default: [] })
  agentTools: string[];

  /**
   * Child swarms this worker may invoke via OpenAI function calling.
   * Each id is exposed as `swarm_<objectId>`.
   */
  @Prop({ type: [String], default: [] })
  swarmTools: string[];

  @Prop({ default: false })
  compressOutput: boolean;

  @Prop({ default: 3, min: 0 })
  maxRetries: number;

  /** Per-run timeout ceiling in milliseconds. */
  @Prop({ default: 60_000, min: 1 })
  timeoutMs: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;
}

export const AgentWorkerSchema = SchemaFactory.createForClass(AgentWorker);

AgentWorkerSchema.index({ createdBy: 1, name: 1 });
