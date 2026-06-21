import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SwarmRunApprovalStatus } from '../types/swarm-run-approval-status.enum';
import type { UserApprovalDecision } from '../types/user-approval-node.types';

export type SwarmRunApprovalDocument = HydratedDocument<SwarmRunApproval>;

@Schema({ timestamps: true, collection: 'swarm_run_approvals' })
export class SwarmRunApproval {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SwarmRun', required: true, index: true })
  swarmRunId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Swarm', required: true, index: true })
  swarmId: Types.ObjectId;

  @Prop({ type: String, required: true })
  nodeId: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, default: '' })
  message: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  passthrough: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  assigneeUserId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  requestedBy: Types.ObjectId;

  @Prop({
    type: String,
    enum: SwarmRunApprovalStatus,
    default: SwarmRunApprovalStatus.PENDING,
    index: true,
  })
  status: SwarmRunApprovalStatus;

  @Prop({ type: String, default: null })
  decision: UserApprovalDecision | null;

  @Prop({ default: '' })
  comment: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  decidedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decidedAt: Date | null;
}

export const SwarmRunApprovalSchema = SchemaFactory.createForClass(SwarmRunApproval);

SwarmRunApprovalSchema.index({ assigneeUserId: 1, status: 1, createdAt: -1 });
SwarmRunApprovalSchema.index({ swarmRunId: 1, status: 1 });
