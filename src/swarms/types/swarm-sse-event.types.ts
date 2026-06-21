/** SSE payloads for `POST /swarms/:id/run/stream` and worker preview stream. */
import type { AgentWorkerRunInput } from '../context/swarm-context.types';

export type SwarmGraphNodeKind =
  | 'start'
  | 'scraper'
  | 'research_papers'
  | 'swarm'
  | 'ifelse'
  | 'while'
  | 'user_approval'
  | 'user_input'
  | 'end'
  | 'worker';

/** @deprecated Prefer `SwarmGraphNodeKind`. */
export type SwarmControlNodeKind = SwarmGraphNodeKind;

export type SwarmNodeSkippedReason = 'branch_pruned' | 'unreachable';

export type SwarmSseEvent =
  | {
      type: 'swarm_start';
      swarmId: string;
      swarmRunId: string;
      runKind: 'swarm' | 'worker_preview';
    }
  | {
      type: 'node_start';
      nodeId: string;
      nodeKind: SwarmGraphNodeKind;
      nodeName: string;
      step: number;
      wave: number;
    }
  | {
      type: 'node_done';
      nodeId: string;
      nodeKind: SwarmGraphNodeKind;
      nodeName: string;
      step: number;
      wave: number;
      output: Record<string, unknown>;
      latencyMs: number;
    }
  | {
      type: 'node_skipped';
      nodeId: string;
      nodeKind: SwarmGraphNodeKind;
      nodeName: string;
      wave: number;
      reason: SwarmNodeSkippedReason;
      fromNodeId?: string;
    }
  | {
      type: 'scale_expand';
      nodeId: string;
      count: number;
      wave: number;
    }
  | {
      type: 'scale_shard_start';
      nodeId: string;
      shardIndex: number;
      wave: number;
    }
  | {
      type: 'scale_shard_done';
      nodeId: string;
      shardIndex: number;
      wave: number;
      latencyMs: number;
    }
  | {
      type: 'scale_collapse';
      nodeId: string;
      wave: number;
    }
  | {
      type: 'worker_start';
      nodeId: string;
      workerId: string;
      workerName: string;
      step: number;
      wave: number;
      /** Present when the worker run is one shard of a scalable agent node. */
      shardIndex?: number;
    }
  | {
      type: 'worker_meta';
      nodeId: string;
      workerId: string;
      provider: string;
      model: string;
      baseURL: string;
      wave: number;
      shardIndex?: number;
    }
  | {
      type: 'delta';
      nodeId: string;
      workerId: string;
      delta: string;
      wave: number;
      shardIndex?: number;
    }
  | {
      type: 'worker_done';
      nodeId: string;
      workerId: string;
      agentRunId: string;
      output: Record<string, unknown>;
      latencyMs: number;
      step: number;
      wave: number;
      shardIndex?: number;
      /** Full payload used by executor/inference call for this worker. */
      inferenceRequest?: AgentWorkerRunInput;
      /** Provider request/response trace persisted on the agent run. */
      inference?: {
        request: Record<string, unknown> | null;
        response: Record<string, unknown> | null;
      };
      /** Chat messages sent to / returned from inference. */
      messages?: Array<{
        role: string;
        content: string;
        tokensUsed?: number;
      }>;
    }
  | {
      type: 'approval_required';
      approvalId: string;
      swarmRunId: string;
      swarmId: string;
      nodeId: string;
      name: string;
      message: string;
      passthrough: Record<string, unknown>;
      assigneeUserId: string;
    }
  | {
      type: 'swarm_done';
      swarmRun: Record<string, unknown>;
      output: Record<string, unknown> | null;
      durationMs: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number | null;
      scrapeCostUsd: number;
      totalCostUsd: number;
    }
  | {
      type: 'error';
      message: string;
    };

export type SwarmStreamExecute = (
  nodeId: string,
  workerId: import('mongoose').Types.ObjectId,
  worker: import('../schemas/agent-worker.schema').AgentWorkerDocument,
  wave: number,
) => Promise<Record<string, unknown>>;

export type SwarmTraversalStreaming = {
  nextStep: () => number;
  emit: (event: SwarmSseEvent) => void;
  execute: SwarmStreamExecute;
};
