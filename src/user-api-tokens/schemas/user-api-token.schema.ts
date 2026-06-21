import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type UserApiTokenDocument = HydratedDocument<UserApiToken>;

@Schema({ timestamps: true, collection: 'user_api_tokens' })
export class UserApiToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ default: '' })
  name: string;

  @Prop({ required: true, select: false })
  tokenHash: string;

  /** Short prefix of the raw token for display (not secret); see AGENT_KEY_PREFIX. */
  @Prop({ required: true })
  prefix: string;

  @Prop({ type: Date, default: null })
  lastUsedAt: Date | null;
}

export const UserApiTokenSchema = SchemaFactory.createForClass(UserApiToken);

UserApiTokenSchema.index({ userId: 1, createdAt: -1 });
