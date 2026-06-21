import { Types } from 'mongoose';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';

export type WorkerInferenceMessage = {
  role: string;
  content: string;
  tokensUsed: number;
};

export type WorkerInferenceTrace = {
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
};

export interface WorkerExecutionResult {
  output: Record<string, unknown>;
  agentRunId: Types.ObjectId;
  inference?: WorkerInferenceTrace;
  messages?: WorkerInferenceMessage[];
}

/** Optional hooks while a worker runs (token deltas for SSE). */
export interface WorkerExecutionStreamHooks {
  onMeta?: (meta: { provider: string; model: string; baseURL: string }) => void;
  onDelta?: (delta: string) => void;
}

/**
 * Pluggable LLM/runtime hook. SwarmOrchestrator delegates actual inference here.
 */
export interface AgentWorkerExecutor {
  execute(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
  ): Promise<WorkerExecutionResult>;

  /** When true, {@link executeStreaming} is available for SSE swarm runs. */
  supportsStreaming?(): boolean;

  executeStreaming?(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
    hooks: WorkerExecutionStreamHooks,
  ): Promise<WorkerExecutionResult>;
}

export const AGENT_WORKER_EXECUTOR = Symbol('AGENT_WORKER_EXECUTOR');
