import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { InferenceProviderKind } from '../../inference/types/inference-provider-kind.enum';

@Schema({ _id: false })
export class SwarmRunModelUsage {
  @Prop({ type: String, enum: InferenceProviderKind, required: true })
  provider: InferenceProviderKind;

  @Prop({ required: true })
  model: string;

  @Prop({ default: 0, min: 0 })
  promptTokens: number;

  @Prop({ default: 0, min: 0 })
  completionTokens: number;

  @Prop({ default: 0, min: 0 })
  totalTokens: number;

  @Prop({ type: Number, default: null })
  costUsd: number | null;

  @Prop({ default: 1, min: 1 })
  agentRunCount: number;
}

export const SwarmRunModelUsageSchema = SchemaFactory.createForClass(SwarmRunModelUsage);
