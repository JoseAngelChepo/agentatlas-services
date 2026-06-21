import type { SubSwarmPendingInput } from './sub-swarm-pending-input.types';

/** Persisted orchestrator state while a run waits on human approval. */
export type SwarmRunCheckpoint = {
  completedNodeIds: string[];
  skippedNodeIds: string[];
  visitCount: Record<string, number>;
  nodeOutputs: Record<string, Record<string, unknown>>;
  workerOutputs: Record<string, Record<string, unknown>>;
  shared: Record<string, unknown>;
  waveMaxDurationsMs: number[];
  pendingApprovalNodeId: string;
  pendingNeedsInputNodeId?: string | null;
  /** Set when a nested sub-swarm bubbled `user_input` to this root run. */
  pendingSubSwarm?: SubSwarmPendingInput | null;
  maxVisits: number;
  goal: string;
  runInput: Record<string, unknown>;
};
