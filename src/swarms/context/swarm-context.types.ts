import { Types } from 'mongoose';

/** Parallel to `upstream[]` — graph predecessor metadata for prompt tokens. */
export interface UpstreamSourceMeta {
  workerId: string;
  workerName: string;
  /** Graph node id — used in `{{upstream.<nodeSlug>.field}}` when names collide. */
  nodeId?: string;
  /** Short prompt ref (`data.ref`), e.g. `agent_1`. */
  ref?: string;
}

/** Payload passed into a single AgentWorker execution. */
export interface AgentWorkerRunInput {
  goal?: string;
  systemPrompt: string;
  /** Outputs from upstream graph nodes (per worker id). */
  upstream: Record<string, unknown>[];
  /** Predecessor labels aligned with `upstream` indices. */
  upstreamMeta?: UpstreamSourceMeta[];
  /** Keys shared across workers in the same swarm run. */
  shared: Record<string, unknown>;
  /** Initial swarm run input from the caller. */
  runInput: Record<string, unknown>;
  /** Extra messages after Instructions — see `buildWorkerChatMessages`. */
  promptMessages?: Array<{ role: 'system' | 'user'; content: string }>;
}

export interface SwarmContextOptions {
  goal: string;
  swarmRunId: Types.ObjectId;
  runInput?: Record<string, unknown>;
}
