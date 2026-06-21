import { Types } from 'mongoose';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { resolveUpstreamPayloadForNode } from '../utils/build-swarm-expression-context';
import {
  buildGraphIndex,
  type GraphIndex,
  workerNodeIdForWorkerKey,
} from '../utils/graph-index';
import { upstreamRefForIndexedNode } from '../utils/swarm-node-ref';
import { parseSwarmNodeData } from './evaluate-swarm-node';

function workerIdKey(id: Types.ObjectId | string): string {
  return id.toString();
}

function upstreamPayloadFromNode(
  fromNodeId: string,
  graph: SwarmGraph,
  context: SwarmContext,
  index: GraphIndex,
): Record<string, unknown> | null {
  return resolveUpstreamPayloadForNode(fromNodeId, graph, index, context);
}

type UpstreamBinding = {
  nodeId: string;
  workerId: string;
  workerName: string;
  payload: Record<string, unknown>;
};

function predecessorMetaFromFromNode(
  fromNodeId: string,
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  workers: Map<string, AgentWorker>,
): { workerId: string; workerName: string } | null {
  const fromNode = graphIndex.nodesById.get(fromNodeId);
  if (fromNode?.kind === GraphNodeKind.WORKER && fromNode.workerId) {
    const fromKey = fromNode.workerId.toString();
    const upstreamWorker = workers.get(fromKey);
    return {
      workerId: fromKey,
      workerName: upstreamWorker?.name ?? fromKey.slice(-6),
    };
  }
  if (fromNode?.kind === GraphNodeKind.IF_ELSE || fromNode?.kind === GraphNodeKind.WHILE) {
    const incoming = graph.edges.filter((edge) => edge.to.toString() === fromNodeId);
    for (const edge of incoming) {
      const nested = graphIndex.nodesById.get(edge.from.toString());
      if (nested?.kind === GraphNodeKind.WORKER && nested.workerId) {
        const fromKey = nested.workerId.toString();
        const upstreamWorker = workers.get(fromKey);
        return {
          workerId: fromKey,
          workerName: upstreamWorker?.name ?? fromKey.slice(-6),
        };
      }
    }
  }
  if (fromNode?.kind === GraphNodeKind.SCRAPER) {
    return {
      workerId: fromNodeId,
      workerName: 'Scraper',
    };
  }
  if (fromNode?.kind === GraphNodeKind.RESEARCH_PAPERS) {
    return {
      workerId: fromNodeId,
      workerName: 'Research papers',
    };
  }
  if (fromNode?.kind === GraphNodeKind.SWARM) {
    const data = parseSwarmNodeData(fromNode.data);
    return {
      workerId: fromNodeId,
      workerName:
        typeof data.label === 'string' && data.label.trim() ? data.label.trim() : 'Sub-swarm',
    };
  }
  if (fromNode?.kind === GraphNodeKind.USER_APPROVAL) {
    const incoming = graph.edges.filter((edge) => edge.to.toString() === fromNodeId);
    for (const edge of incoming) {
      const nested = graphIndex.nodesById.get(edge.from.toString());
      if (nested?.kind === GraphNodeKind.WORKER && nested.workerId) {
        const fromKey = nested.workerId.toString();
        const upstreamWorker = workers.get(fromKey);
        return {
          workerId: fromKey,
          workerName: upstreamWorker?.name ?? fromKey.slice(-6),
        };
      }
    }
    return {
      workerId: fromNodeId,
      workerName: 'User approval',
    };
  }
  const fromKey = fromNodeId;
  const upstreamWorker = workers.get(fromKey);
  return {
    workerId: fromKey,
    workerName: upstreamWorker?.name ?? fromKey.slice(-6),
  };
}

function bindingFromFromNode(
  fromNodeId: string,
  graph: SwarmGraph,
  context: SwarmContext,
  graphIndex: GraphIndex,
  workers: Map<string, AgentWorker>,
): UpstreamBinding | null {
  const payload = upstreamPayloadFromNode(fromNodeId, graph, context, graphIndex);
  if (!payload) {
    return null;
  }
  const meta = predecessorMetaFromFromNode(fromNodeId, graph, graphIndex, workers);
  if (!meta) {
    return null;
  }
  return { nodeId: fromNodeId, ...meta, payload };
}

/** Direct + transitive graph predecessors (direct first, deduped by graph node id). */
function collectTransitiveUpstreamBindings(
  nodeId: string,
  graph: SwarmGraph,
  context: SwarmContext,
  graphIndex: GraphIndex,
  workers: Map<string, AgentWorker>,
): UpstreamBinding[] {
  const seen = new Set<string>();
  const seenWorkerIds = new Set<string>();
  const result: UpstreamBinding[] = [];

  function append(fromNodeId: string): void {
    const binding = bindingFromFromNode(fromNodeId, graph, context, graphIndex, workers);
    if (!binding || seen.has(binding.nodeId)) {
      return;
    }
    // If/else passthrough already carries the predecessor worker output; skip the
    // same worker again when walking transitive ancestors (e.g. Matcher → If/else → Reconciler).
    if (seenWorkerIds.has(binding.workerId)) {
      return;
    }
    seen.add(binding.nodeId);
    seenWorkerIds.add(binding.workerId);
    result.push(binding);
  }

  function walkAncestors(fromNodeId: string, depth: number): void {
    if (depth > 8) {
      return;
    }
    for (const edge of graph.edges) {
      if (edge.to.toString() !== fromNodeId) {
        continue;
      }
      append(edge.from.toString());
      walkAncestors(edge.from.toString(), depth + 1);
    }
  }

  for (const edge of graph.edges) {
    if (edge.to.toString() !== nodeId) {
      continue;
    }
    append(edge.from.toString());
    walkAncestors(edge.from.toString(), 0);
  }

  return result;
}

/** Graph predecessors for a worker (direct + transitive), for prompt `{{upstream.*}}` tokens. */
export function buildUpstreamMeta(
  workerId: Types.ObjectId,
  graph: SwarmGraph,
  workers: Map<string, AgentWorker>,
  index?: GraphIndex,
): { workerId: string; workerName: string }[] {
  const graphIndex = index ?? buildGraphIndex(graph);
  const nodeId = workerNodeIdForWorkerKey(graphIndex, workerIdKey(workerId));
  const seen = new Set<string>();
  const seenWorkerIds = new Set<string>();
  const result: { workerId: string; workerName: string }[] = [];

  function append(fromNodeId: string): void {
    const meta = predecessorMetaFromFromNode(fromNodeId, graph, graphIndex, workers);
    if (!meta || seen.has(fromNodeId)) {
      return;
    }
    if (seenWorkerIds.has(meta.workerId)) {
      return;
    }
    seen.add(fromNodeId);
    seenWorkerIds.add(meta.workerId);
    result.push(meta);
  }

  function walkAncestors(fromNodeId: string, depth: number): void {
    if (depth > 8) {
      return;
    }
    for (const edge of graph.edges) {
      if (edge.to.toString() !== fromNodeId) {
        continue;
      }
      append(edge.from.toString());
      walkAncestors(edge.from.toString(), depth + 1);
    }
  }

  for (const edge of graph.edges) {
    if (edge.to.toString() !== nodeId) {
      continue;
    }
    append(edge.from.toString());
    walkAncestors(edge.from.toString(), 0);
  }

  return result;
}

const DEFAULT_UPSTREAM_FIELDS = [
  'summary',
  'intent',
  'result',
  'decision',
  'data',
  'confidence',
  'reason',
];

/**
 * Builds the input payload for a worker from graph topology and completed upstream outputs.
 */
export function resolveWorkerInput(
  workerId: Types.ObjectId,
  worker: AgentWorker,
  graph: SwarmGraph,
  context: SwarmContext,
  workers?: Map<string, AgentWorker>,
  index?: GraphIndex,
): AgentWorkerRunInput {
  const graphIndex = index ?? buildGraphIndex(graph);
  const key = workerIdKey(workerId);
  const nodeId = workerNodeIdForWorkerKey(graphIndex, key);
  const workerMap = workers ?? new Map<string, AgentWorker>();
  const bindings = collectTransitiveUpstreamBindings(
    nodeId,
    graph,
    context,
    graphIndex,
    workerMap,
  );
  const incoming = bindings.map((binding) => binding.payload);

  const upstream = worker.compressOutput
    ? compressUpstream(incoming, worker.upstreamFields)
    : incoming;

  const runInput = buildWorkerRunInput(worker, context, upstream);
  if (workers) {
    runInput.upstreamMeta = bindings.map(({ nodeId: graphNodeId, workerId: id, workerName }) => {
      const indexed = graphIndex.nodesById.get(graphNodeId);
      const ref = indexed
        ? upstreamRefForIndexedNode(graphNodeId, indexed.data, workerName)
        : undefined;
      return {
        nodeId: graphNodeId,
        workerId: id,
        workerName,
        ref,
      };
    });
  }
  return runInput;
}

/**
 * Builds run input for workspace worker preview (manual upstream, no graph).
 */
export function buildPreviewWorkerInput(
  worker: AgentWorker,
  context: SwarmContext,
  manualUpstream: Record<string, unknown>[],
): AgentWorkerRunInput {
  const upstream = worker.compressOutput
    ? compressUpstream(manualUpstream, worker.upstreamFields)
    : manualUpstream;
  return buildWorkerRunInput(worker, context, upstream);
}

function buildWorkerRunInput(
  worker: AgentWorker,
  context: SwarmContext,
  upstream: Record<string, unknown>[],
): AgentWorkerRunInput {
  const promptMessages =
    worker.promptMessages?.filter((m) => m.content.trim().length > 0).map((m) => ({
      role: m.role,
      content: m.content,
    })) ?? [];

  return {
    goal: context.goal,
    systemPrompt: worker.systemPrompt,
    upstream,
    shared: context.getShared(),
    runInput: context.runInput,
    ...(promptMessages.length > 0 ? { promptMessages } : {}),
  };
}

function compressUpstream(
  outputs: Record<string, unknown>[],
  configuredFields?: string[],
): Record<string, unknown>[] {
  const projection = normalizeProjectionKeys(configuredFields);
  return outputs.map((output) => ({
    summary: pickStructuredFields(output, projection),
  }));
}

function pickStructuredFields(
  output: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const compressed: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in output) {
      compressed[key] = output[key];
    }
  }
  if (Object.keys(compressed).length === 0) {
    return { payload: output };
  }
  return compressed;
}

function normalizeProjectionKeys(configuredFields?: string[]): string[] {
  const source =
    Array.isArray(configuredFields) && configuredFields.length > 0
      ? configuredFields
      : DEFAULT_UPSTREAM_FIELDS;
  return source
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}
