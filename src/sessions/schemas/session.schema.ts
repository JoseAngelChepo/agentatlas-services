import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

export enum SessionType {
  BROWSER = 'browser',
}

@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: SessionType, required: true })
  type: SessionType;

  @Prop({ required: true })
  refreshToken: string;

  @Prop({ default: Date.now })
  lastUsed: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.index({ refreshToken: 1 }, { unique: true });
SessionSchema.index({ userId: 1 });
