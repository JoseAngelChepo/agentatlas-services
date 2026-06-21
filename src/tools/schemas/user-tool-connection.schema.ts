import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PlatformToolKey } from '../types/platform-tool.types';

export type UserToolConnectionDocument = HydratedDocument<UserToolConnection>;

/**
 * A user-connected platform integration (Gmail, Slack, …).
 * Catalog entries are global; availability in `runInput.toolsAvailable` depends on rows here.
 */
@Schema({ timestamps: true, collection: 'user_tool_connections' })
export class UserToolConnection {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: PlatformToolKey, required: true })
  platformToolKey: PlatformToolKey;

  @Prop({ type: Date, required: true })
  connectedAt: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata: Record<string, unknown> | null;
}

export const UserToolConnectionSchema = SchemaFactory.createForClass(UserToolConnection);

UserToolConnectionSchema.index({ userId: 1, platformToolKey: 1 }, { unique: true });
