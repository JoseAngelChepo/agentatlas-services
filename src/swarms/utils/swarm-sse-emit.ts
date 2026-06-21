import type { AgentWorker } from '../schemas/agent-worker.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type {
  SwarmGraphNodeKind,
  SwarmNodeSkippedReason,
  SwarmSseEvent,
} from '../types/swarm-sse-event.types';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import {
  parseUserApprovalNodeData,
  parseUserInputNodeData,
  type GraphIndex,
  type IndexedGraphNode,
} from './graph-index';
import { parseScraperNodeData } from '../orchestrator/evaluate-scraper-node';
import { parseResearchPapersNodeData } from '../orchestrator/evaluate-research-papers-node';
import { parseSwarmNodeData } from '../orchestrator/evaluate-swarm-node';

export function sseNodeKind(indexed: IndexedGraphNode): SwarmGraphNodeKind {
  switch (indexed.kind) {
    case GraphNodeKind.START:
      return 'start';
    case GraphNodeKind.SCRAPER:
      return 'scraper';
    case GraphNodeKind.RESEARCH_PAPERS:
      return 'research_papers';
    case GraphNodeKind.SWARM:
      return 'swarm';
    case GraphNodeKind.IF_ELSE:
      return 'ifelse';
    case GraphNodeKind.WHILE:
      return 'while';
    case GraphNodeKind.USER_APPROVAL:
      return 'user_approval';
    case GraphNodeKind.USER_INPUT:
      return 'user_input';
    case GraphNodeKind.END:
      return 'end';
    default:
      return 'worker';
  }
}

export function sseNodeName(
  indexed: IndexedGraphNode,
  workers: Map<string, AgentWorker>,
): string {
  switch (indexed.kind) {
    case GraphNodeKind.START:
      return 'Start';
    case GraphNodeKind.IF_ELSE:
      return 'If / else';
    case GraphNodeKind.WHILE:
      return 'While';
    case GraphNodeKind.SCRAPER: {
      const data = parseScraperNodeData(indexed.data);
      return typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : 'Web scrape';
    }
    case GraphNodeKind.RESEARCH_PAPERS: {
      const data = parseResearchPapersNodeData(indexed.data);
      return typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : 'Research papers';
    }
    case GraphNodeKind.SWARM: {
      const data = parseSwarmNodeData(indexed.data);
      return typeof data.label === 'string' && data.label.trim()
        ? data.label.trim()
        : 'Sub-swarm';
    }
    case GraphNodeKind.END: {
      const label = indexed.data?.label;
      return typeof label === 'string' && label.trim() ? label.trim() : 'End';
    }
    case GraphNodeKind.USER_APPROVAL: {
      const data = parseUserApprovalNodeData(indexed.data);
      return typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : 'User approval';
    }
    case GraphNodeKind.USER_INPUT: {
      const data = parseUserInputNodeData(indexed.data);
      return typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : 'Needs input';
    }
    default: {
      const workerKey = indexed.workerId?.toString();
      if (!workerKey) {
        return indexed.id;
      }
      return workers.get(workerKey)?.name ?? workerKey.slice(-6);
    }
  }
}

export function emitNodeSkipped(
  emit: (event: SwarmSseEvent) => void,
  params: {
    graphIndex: GraphIndex;
    nodeId: string;
    wave: number;
    reason: SwarmNodeSkippedReason;
    fromNodeId?: string;
    workers: Map<string, AgentWorker>;
  },
): void {
  const indexed = params.graphIndex.nodesById.get(params.nodeId);
  if (!indexed) {
    return;
  }
  emit({
    type: 'node_skipped',
    nodeId: params.nodeId,
    nodeKind: sseNodeKind(indexed),
    nodeName: sseNodeName(indexed, params.workers),
    wave: params.wave,
    reason: params.reason,
    fromNodeId: params.fromNodeId,
  });
}

export function emitWorkerStreamStart(
  emit: (event: SwarmSseEvent) => void,
  params: {
    nodeId: string;
    workerId: string;
    workerName: string;
    step: number;
    wave: number;
  },
): void {
  emit({
    type: 'node_start',
    nodeId: params.nodeId,
    nodeKind: 'worker',
    nodeName: params.workerName,
    step: params.step,
    wave: params.wave,
  });
  emit({
    type: 'worker_start',
    nodeId: params.nodeId,
    workerId: params.workerId,
    workerName: params.workerName,
    step: params.step,
    wave: params.wave,
  });
}

export function emitWorkerStreamDone(
  emit: (event: SwarmSseEvent) => void,
  params: {
    nodeId: string;
    workerId: string;
    workerName: string;
    step: number;
    wave: number;
    agentRunId: string;
    output: Record<string, unknown>;
    latencyMs: number;
    inferenceRequest?: AgentWorkerRunInput;
    inference?: {
      request: Record<string, unknown> | null;
      response: Record<string, unknown> | null;
    };
    messages?: Array<{
      role: string;
      content: string;
      tokensUsed?: number;
    }>;
  },
): void {
  emit({
    type: 'node_done',
    nodeId: params.nodeId,
    nodeKind: 'worker',
    nodeName: params.workerName,
    step: params.step,
    wave: params.wave,
    output: params.output,
    latencyMs: params.latencyMs,
  });
  emit({
    type: 'worker_done',
    nodeId: params.nodeId,
    workerId: params.workerId,
    agentRunId: params.agentRunId,
    output: params.output,
    latencyMs: params.latencyMs,
    step: params.step,
    wave: params.wave,
    inferenceRequest: params.inferenceRequest,
    inference: params.inference,
    messages: params.messages,
  });
}
