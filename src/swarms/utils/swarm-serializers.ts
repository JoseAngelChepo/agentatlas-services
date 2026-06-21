import type { AgentRunDocument } from '../schemas/agent-run.schema';
import type { AgentWorkerDocument } from '../schemas/agent-worker.schema';
import type { SwarmGraphDocument } from '../schemas/swarm-graph.schema';
import type { SwarmRunDocument } from '../schemas/swarm-run.schema';
import type { SwarmRunModelUsage } from '../schemas/swarm-run-model-usage.schema';
import type {
  SwarmRunScrapeRequestLine,
  SwarmRunScrapeUsage,
} from '../schemas/swarm-run-scrape-usage.schema';
import type { SwarmDocument } from '../schemas/swarm.schema';
import { plainSubdocument, plainSubdocumentArray } from '../../common/utils/plain-mongoose';
import { SwarmRunKind } from '../types/swarm-run-kind.enum';
import { resolveNodeKind } from './graph-index';

type WithTimestamps = { createdAt?: Date; updatedAt?: Date };

type PlainAgentWorkerModel = {
  provider: string;
  name: string;
  contextWindow?: number;
  params?: Record<string, unknown>;
};

/** Mongoose subdocuments must be plain-object serialized before JSON responses. */
function plainAgentWorkerModel(model: AgentWorkerDocument['model']): PlainAgentWorkerModel {
  const raw = plainSubdocument<PlainAgentWorkerModel & { params?: Record<string, unknown> }>(model);

  if (!raw) {
    return { provider: '', name: '', params: {} };
  }

  return {
    provider: raw.provider,
    name: raw.name,
    ...(raw.contextWindow != null ? { contextWindow: raw.contextWindow } : {}),
    params: plainSubdocument(raw.params) ?? raw.params ?? {},
  };
}

export function serializeAgentWorker(doc: AgentWorkerDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;
  return {
    id: doc.id,
    name: doc.name,
    model: plainAgentWorkerModel(doc.model),
    systemPrompt: doc.systemPrompt,
    promptMessages: (doc.promptMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    upstreamFields: doc.upstreamFields ?? [],
    inputSchema: doc.inputSchema,
    outputSchema: doc.outputSchema,
    openaiTools: doc.openaiTools ?? {},
    grokTools: doc.grokTools ?? {},
    agentTools: doc.agentTools ?? [],
    swarmTools: doc.swarmTools ?? [],
    compressOutput: doc.compressOutput,
    maxRetries: doc.maxRetries,
    timeoutMs: doc.timeoutMs,
    createdBy: doc.createdBy.toString(),
    createdAt,
    updatedAt,
  };
}

export function serializeSwarm(doc: SwarmDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    goal: doc.goal,
    topology: doc.topology,
    workers: doc.workers.map((id) => id.toString()),
    createdBy: doc.createdBy.toString(),
    version: doc.version,
    isPublic: doc.isPublic,
    platformRunnable: doc.platformRunnable ?? false,
    triggers: doc.triggers ?? [],
    active: doc.active ?? true,
    createdAt,
    updatedAt,
  };
}

export function serializeSwarmGraph(doc: SwarmGraphDocument) {
  const raw = doc.toObject() as unknown as WithTimestamps & {
    nodes?: Array<Record<string, unknown>>;
  };
  const { createdAt, updatedAt } = raw;
  return {
    id: doc.id,
    swarmId: doc.swarmId.toString(),
    nodes: doc.nodes.map((n, idx) => {
      const legacy = (raw.nodes?.[idx] ?? {}) as {
        positionX?: number;
        positionY?: number;
      };
      const workerIdStr = n.workerId?.toString();
      const positionRaw = plainSubdocument<{ x?: number; y?: number }>(n.position) ?? n.position;
      const position = positionRaw ?? {
        x: legacy.positionX ?? 0,
        y: legacy.positionY ?? 0,
      };
      const kind = n.kind ?? resolveNodeKind(n);
      return {
        id: n.id ?? workerIdStr ?? '',
        kind,
        workerId: workerIdStr ?? null,
        type: n.type ?? kind,
        position: {
          x: position.x ?? 0,
          y: position.y ?? 0,
        },
        data: n.data ?? {},
      };
    }),
    edges: doc.edges.map((e) => ({
      from: e.from.toString(),
      to: e.to.toString(),
      type: e.type,
      condition: e.condition,
      sourceHandle: e.sourceHandle ?? null,
    })),
    entryNode: doc.entryNode?.toString?.() ?? '',
    exitNode: doc.exitNode?.toString?.() ?? '',
    createdAt,
    updatedAt,
  };
}

function serializeScrapeUsage(raw: SwarmRunScrapeUsage | undefined) {
  const usage = plainSubdocument<SwarmRunScrapeUsage>(raw);
  if (!usage) {
    return { requestCount: 0, browserDurationMs: 0, costUsd: 0, requests: [] };
  }
  return {
    requestCount: usage.requestCount ?? 0,
    browserDurationMs: usage.browserDurationMs ?? 0,
    costUsd: usage.costUsd ?? 0,
    requests: plainSubdocumentArray<SwarmRunScrapeRequestLine>(usage.requests ?? []).map((line) => ({
      scrapeRequestId: line.scrapeRequestId,
      url: line.url,
      latencyMs: line.latencyMs ?? 0,
      costUsd: line.costUsd ?? 0,
      status: line.status,
    })),
  };
}

function serializeUsageByModel(lines: SwarmRunModelUsage[] | undefined) {
  return plainSubdocumentArray<SwarmRunModelUsage>(lines ?? []).map((line) => ({
    provider: line.provider,
    model: line.model,
    promptTokens: line.promptTokens ?? 0,
    completionTokens: line.completionTokens ?? 0,
    totalTokens: line.totalTokens ?? 0,
    costUsd: line.costUsd ?? null,
    agentRunCount: line.agentRunCount ?? 1,
  }));
}

export function serializeSwarmRun(doc: SwarmRunDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;
  return {
    id: doc.id,
    swarmId: doc.swarmId.toString(),
    triggeredBy: doc.triggeredBy.toString(),
    runKind: doc.runKind ?? SwarmRunKind.SWARM,
    parentSwarmRunId: doc.parentSwarmRunId?.toString() ?? null,
    parentNodeId: doc.parentNodeId ?? null,
    depth: doc.depth ?? 0,
    input: doc.input,
    output: doc.output,
    agentRuns: doc.agentRuns.map((id) => id.toString()),
    status: doc.status,
    durationMs: doc.durationMs,
    promptTokens: doc.promptTokens ?? 0,
    completionTokens: doc.completionTokens ?? 0,
    totalTokens: doc.totalTokens ?? 0,
    costUsd: doc.costUsd ?? null,
    scrapeCostUsd: doc.scrapeCostUsd ?? 0,
    totalCostUsd: doc.totalCostUsd ?? 0,
    usageByModel: serializeUsageByModel(doc.usageByModel),
    scrapeUsage: serializeScrapeUsage(doc.scrapeUsage),
    failureReason: doc.failureReason,
    pendingApprovalId: doc.pendingApprovalId?.toString() ?? null,
    hasCheckpoint: doc.checkpoint != null,
    createdAt,
    updatedAt,
  };
}

export function serializeAgentRun(doc: AgentRunDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;
  const inferenceRaw =
    plainSubdocument<{ request?: unknown; response?: unknown }>(doc.inference) ??
    ({ request: null, response: null } as { request: null; response: null });

  return {
    id: doc.id,
    workerId: doc.workerId.toString(),
    swarmRunId: doc.swarmRunId.toString(),
    messages: plainSubdocumentArray<{
      role: unknown;
      content: unknown;
      tokensUsed?: unknown;
      timestamp?: unknown;
    }>(doc.messages).map((message) => ({
        role: message.role,
        content: message.content,
        tokensUsed: message.tokensUsed ?? 0,
        timestamp: message.timestamp,
    })),
    input: doc.input,
    output: doc.output,
    inference: {
      request: inferenceRaw.request ?? null,
      response: inferenceRaw.response ?? null,
    },
    status: doc.status,
    durationMs: doc.durationMs,
    attempt: doc.attempt,
    createdAt,
    updatedAt,
  };
}
