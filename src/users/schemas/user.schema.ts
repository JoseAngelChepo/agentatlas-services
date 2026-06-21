import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

/** Individual billing / product tier. */
export enum AccountTier {
  FREE = 'free',
  PAID = 'paid',
}

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** Unique handle; sparse index so legacy documents without a username remain valid. */
  @Prop({ required: false, unique: true, sparse: true, lowercase: true, trim: true })
  username?: string;

  @Prop({ required: false })
  password?: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: String, enum: AccountTier, default: AccountTier.FREE })
  accountTier: AccountTier;

  @Prop({ type: String, enum: AuthProvider, default: AuthProvider.LOCAL })
  authProvider: AuthProvider;

  @Prop({ required: false })
  avatar?: string;

  @Prop({ required: false, unique: true, sparse: true })
  googleId?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isEmailVerified: boolean;

  /** When true, user may create swarms via POST /swarms. Off by default until explicitly enabled. */
  @Prop({ default: false })
  canCreateSwarms: boolean;

  @Prop({ required: false })
  passwordResetToken?: string;

  @Prop({ required: false })
  passwordResetExpires?: Date;

  @Prop({ required: false })
  lastLogin?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
