import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { GraphEdgeType } from '../types/graph-edge-type.enum';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { WorkerNodeType } from '../types/worker-node-type.enum';

export type SwarmGraphDocument = HydratedDocument<SwarmGraph>;

@Schema({ _id: false })
export class SwarmNodePosition {
  @Prop({ default: 0 })
  x: number;

  @Prop({ default: 0 })
  y: number;
}

export const SwarmNodePositionSchema = SchemaFactory.createForClass(SwarmNodePosition);

/**
 * Graph node shape mirrors Crewy's React-Flow-friendly format:
 * `{ id, workerId, type, position: { x, y }, data? }`.
 * `id` is a frontend-stable React Flow node id (independent of `workerId` entity id)
 * and `data` is a free-form bag for per-node UI metadata (label overrides, etc.).
 */
@Schema({ _id: false })
export class SwarmGraphNode {
  @Prop({ type: String, required: false })
  id?: string;

  @Prop({ type: String, enum: GraphNodeKind, default: GraphNodeKind.WORKER })
  kind?: GraphNodeKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'AgentWorker', required: false })
  workerId?: Types.ObjectId;

  @Prop({ type: String, enum: WorkerNodeType, default: WorkerNodeType.WORKER })
  type: WorkerNodeType;

  @Prop({ type: SwarmNodePositionSchema, default: () => ({ x: 0, y: 0 }) })
  position: SwarmNodePosition;

  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined })
  data?: Record<string, unknown>;
}

export const SwarmGraphNodeSchema = SchemaFactory.createForClass(SwarmGraphNode);

@Schema({ _id: false })
export class SwarmGraphEdge {
  /** Source graph node id (worker or control node). */
  @Prop({ type: String, required: true })
  from: string;

  /** Target graph node id. */
  @Prop({ type: String, required: true })
  to: string;

  @Prop({ type: String, enum: GraphEdgeType, default: GraphEdgeType.SEQUENTIAL })
  type: GraphEdgeType;

  @Prop({ type: String, default: null })
  condition: string | null;

  /** React Flow branch handle (`case-<id>` | `else`) for If/else nodes. */
  @Prop({ type: String, default: null })
  sourceHandle?: string | null;
}

export const SwarmGraphEdgeSchema = SchemaFactory.createForClass(SwarmGraphEdge);

/**
 * Directed graph for a swarm: nodes are worker blueprints, edges define I/O flow.
 */
@Schema({ timestamps: true, collection: 'swarm_graphs' })
export class SwarmGraph {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Swarm',
    required: true,
    unique: true,
    index: true,
  })
  swarmId: Types.ObjectId;

  @Prop({ type: [SwarmGraphNodeSchema], default: [] })
  nodes: SwarmGraphNode[];

  @Prop({ type: [SwarmGraphEdgeSchema], default: [] })
  edges: SwarmGraphEdge[];

  /** Worker id or graph node id when the flow has no agent nodes. */
  @Prop({ type: String, required: true })
  entryNode: string;

  @Prop({ type: String, required: true })
  exitNode: string;
}

export const SwarmGraphSchema = SchemaFactory.createForClass(SwarmGraph);
