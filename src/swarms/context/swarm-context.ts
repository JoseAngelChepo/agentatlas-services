import { Types } from 'mongoose';
import type { SwarmRunCheckpoint } from '../types/swarm-run-checkpoint.types';
import type { SubSwarmPendingInput } from '../types/sub-swarm-pending-input.types';
import type { SwarmContextOptions } from './swarm-context.types';

/**
 * In-memory context for one swarm run. Share data across AgentWorkers
 * without passing everything through the graph edges.
 */
export class SwarmContext {
  readonly goal: string;
  readonly swarmRunId: Types.ObjectId;
  readonly runInput: Record<string, unknown>;

  private readonly shared = new Map<string, unknown>();
  private readonly workerOutputs = new Map<string, Record<string, unknown>>();
  /** Graph node id → output (workers + control nodes). */
  private readonly nodeOutputs = new Map<string, Record<string, unknown>>();

  constructor(options: SwarmContextOptions) {
    this.goal = options.goal;
    this.swarmRunId = options.swarmRunId;
    this.runInput = options.runInput ?? {};
  }

  getShared(): Record<string, unknown> {
    return Object.fromEntries(this.shared);
  }

  setShared(key: string, value: unknown): void {
    this.shared.set(key, value);
  }

  getSharedValue<T = unknown>(key: string): T | undefined {
    return this.shared.get(key) as T | undefined;
  }

  setWorkerOutput(workerId: string, output: Record<string, unknown>): void {
    this.workerOutputs.set(workerId, output);
  }

  getWorkerOutput(workerId: string): Record<string, unknown> | undefined {
    return this.workerOutputs.get(workerId);
  }

  setNodeOutput(nodeId: string, output: Record<string, unknown>): void {
    this.nodeOutputs.set(nodeId, output);
  }

  getNodeOutput(nodeId: string): Record<string, unknown> | undefined {
    return this.nodeOutputs.get(nodeId);
  }

  deleteNodeOutput(nodeId: string): void {
    this.nodeOutputs.delete(nodeId);
  }

  deleteWorkerOutput(workerId: string): void {
    this.workerOutputs.delete(workerId);
  }

  getAllWorkerOutputs(): Map<string, Record<string, unknown>> {
    return new Map(this.workerOutputs);
  }

  toCheckpoint(params: {
    completedNodeIds: string[];
    skippedNodeIds: string[];
    visitCount: Map<string, number>;
    waveMaxDurationsMs: number[];
    pendingApprovalNodeId: string;
    pendingNeedsInputNodeId?: string | null;
    pendingSubSwarm?: SubSwarmPendingInput | null;
    maxVisits: number;
  }): SwarmRunCheckpoint {
    const visitCount: Record<string, number> = {};
    for (const [nodeId, count] of params.visitCount) {
      visitCount[nodeId] = count;
    }
    const nodeOutputs: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, output] of this.nodeOutputs) {
      nodeOutputs[nodeId] = output;
    }
    const workerOutputs: Record<string, Record<string, unknown>> = {};
    for (const [workerId, output] of this.workerOutputs) {
      workerOutputs[workerId] = output;
    }
    return {
      completedNodeIds: [...params.completedNodeIds],
      skippedNodeIds: [...params.skippedNodeIds],
      visitCount,
      nodeOutputs,
      workerOutputs,
      shared: this.getShared(),
      waveMaxDurationsMs: [...params.waveMaxDurationsMs],
      pendingApprovalNodeId: params.pendingApprovalNodeId,
      pendingNeedsInputNodeId: params.pendingNeedsInputNodeId ?? null,
      pendingSubSwarm: params.pendingSubSwarm ?? null,
      maxVisits: params.maxVisits,
      goal: this.goal,
      runInput: { ...this.runInput },
    };
  }

  static fromCheckpoint(
    checkpoint: SwarmRunCheckpoint,
    swarmRunId: Types.ObjectId,
  ): SwarmContext {
    const context = new SwarmContext({
      goal: checkpoint.goal,
      swarmRunId,
      runInput: checkpoint.runInput,
    });
    for (const [key, value] of Object.entries(checkpoint.shared)) {
      context.setShared(key, value);
    }
    for (const [workerId, output] of Object.entries(checkpoint.workerOutputs)) {
      context.setWorkerOutput(workerId, output);
    }
    for (const [nodeId, output] of Object.entries(checkpoint.nodeOutputs)) {
      context.setNodeOutput(nodeId, output);
    }
    return context;
  }
}
