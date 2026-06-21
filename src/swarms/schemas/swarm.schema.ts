import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SwarmTopology } from '../types/swarm-topology.enum';

export type SwarmDocument = HydratedDocument<Swarm>;

@Schema({ timestamps: true, collection: 'swarms' })
export class Swarm {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true })
  goal: string;

  @Prop({ type: String, enum: SwarmTopology, default: SwarmTopology.HYBRID })
  topology: SwarmTopology;

  /** Worker blueprint ids referenced by the swarm graph. */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'AgentWorker' }],
    default: [],
  })
  workers: Types.ObjectId[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ default: '1.0.0' })
  version: string;

  @Prop({ default: false })
  isPublic: boolean;

  /**
   * Platform / general-use swarms (internal processes, shared templates).
   * Any authenticated user may run or reference as sub-swarm without hiring.
   */
  @Prop({ default: false })
  platformRunnable: boolean;

  /**
   * Routing tags for agent catalogs (`contact_lookup`, `send_message`, …).
   * Merged with platform process keys in `runInput.agentsAvailables`.
   */
  @Prop({ type: [String], default: [] })
  triggers: string[];

  /** When false, the swarm cannot be executed (owner or hired users). */
  @Prop({ default: true })
  active: boolean;
}

export const SwarmSchema = SchemaFactory.createForClass(Swarm);

SwarmSchema.index({ createdBy: 1, name: 1 });
