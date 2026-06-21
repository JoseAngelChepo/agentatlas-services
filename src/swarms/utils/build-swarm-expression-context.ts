import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type { IfElseNodeOutput } from '../types/if-else-node.types';
import type { WhileNodeOutput } from '../types/while-node.types';
import type { UserApprovalNodeOutput } from '../types/user-approval-node.types';
import type { ScraperNodeOutput } from '../../scraper/types/scraper-node.types';
import type { SwarmNodeOutput } from '../types/swarm-node.types';
import type { SwarmExpressionContext } from './evaluate-swarm-expression';
import { type GraphIndex, type IndexedGraphNode } from './graph-index';
import { indexOutputFields } from './swarm-output-fields';

function isWhileOutput(output: Record<string, unknown>): output is WhileNodeOutput {
  return output.kind === 'while';
}

function isIfElseOutput(output: Record<string, unknown>): output is IfElseNodeOutput {
  return output.kind === 'ifelse';
}

function isScraperOutput(output: Record<string, unknown>): output is ScraperNodeOutput {
  return output.kind === 'scraper';
}

function isSwarmOutput(output: Record<string, unknown>): output is SwarmNodeOutput {
  return output.kind === 'swarm';
}

function isUserApprovalOutput(output: Record<string, unknown>): output is UserApprovalNodeOutput {
  return output.kind === 'user_approval';
}

/** Resolves the worker payload feeding a graph node (walks through if/else passthrough). */
export function resolveUpstreamPayloadForNode(
  fromNodeId: string,
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 8) {
    return null;
  }

  const nodeOut = context.getNodeOutput(fromNodeId);
  if (nodeOut && (isIfElseOutput(nodeOut) || isWhileOutput(nodeOut) || isUserApprovalOutput(nodeOut))) {
    const incoming = graph.edges.filter((e) => e.to.toString() === fromNodeId);
    for (const edge of incoming) {
      const nested = resolveUpstreamPayloadForNode(
        edge.from.toString(),
        graph,
        graphIndex,
        context,
        depth + 1,
      );
      if (nested) {
        return nested;
      }
    }
    return nodeOut.passthrough ?? null;
  }

  if (nodeOut && isScraperOutput(nodeOut)) {
    return nodeOut;
  }

  if (nodeOut && isSwarmOutput(nodeOut)) {
    return nodeOut.output ?? nodeOut;
  }

  const fromNode = graphIndex.nodesById.get(fromNodeId);
  if (fromNode?.kind === GraphNodeKind.SCRAPER) {
    return nodeOut ?? null;
  }
  if (fromNode?.kind === GraphNodeKind.RESEARCH_PAPERS) {
    return nodeOut ?? null;
  }
  if (fromNode?.kind === GraphNodeKind.SWARM) {
    const swarmOut = nodeOut as SwarmNodeOutput | undefined;
    return swarmOut?.output ?? nodeOut ?? null;
  }
  if (fromNode?.kind === GraphNodeKind.WORKER && fromNode.workerId) {
    const key = fromNode.workerId.toString();
    return context.getWorkerOutput(key) ?? nodeOut ?? null;
  }

  return nodeOut ?? null;
}

function bindingFromWorkerNode(
  fromNode: IndexedGraphNode,
  fromNodeId: string,
  output: Record<string, unknown>,
  workers: Map<string, AgentWorker>,
): { slug: string; workerId: string; workerName: string; output: Record<string, unknown> } | null {
  if (!fromNode.workerId) {
    return null;
  }
  const workerId = fromNode.workerId.toString();
  const worker = workers.get(workerId);
  const workerName = worker?.name ?? workerId.slice(-6);
  return {
    workerId,
    workerName,
    slug: workerId,
    output,
  };
}

/** All upstream graph node ids on paths into `nodeId` (direct first, deduped). */
function collectTransitiveSourceNodeIds(nodeId: string, graph: SwarmGraph): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function append(fromNodeId: string): void {
    if (seen.has(fromNodeId)) {
      return;
    }
    seen.add(fromNodeId);
    result.push(fromNodeId);
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

function indexUpstreamFromNode(
  fromNodeId: string,
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  workers: Map<string, AgentWorker>,
  upstream: Record<string, unknown>[],
  upstreamBySlug: Record<string, Record<string, unknown>>,
  upstreamByField: Record<string, Record<string, unknown>>,
): void {
  const payload = resolveUpstreamPayloadForNode(fromNodeId, graph, graphIndex, context);
  if (!payload) {
    return;
  }

  const fromNode = graphIndex.nodesById.get(fromNodeId);
  if (!fromNode) {
    upstream.push(payload);
    indexOutputFields(payload, upstreamByField);
    return;
  }

  if (fromNode.kind === GraphNodeKind.WORKER) {
    const binding = bindingFromWorkerNode(fromNode, fromNodeId, payload, workers);
    if (binding) {
      upstream.push(binding.output);
      upstreamBySlug[binding.slug] = binding.output;
      indexOutputFields(binding.output, upstreamByField);
    } else {
      upstream.push(payload);
      indexOutputFields(payload, upstreamByField);
    }
    return;
  }

  if (fromNode.kind === GraphNodeKind.IF_ELSE || fromNode.kind === GraphNodeKind.WHILE) {
    upstream.push(payload);
    const incomingToIf = graph.edges.filter((e) => e.to.toString() === fromNodeId);
    for (const inEdge of incomingToIf) {
      const nestedNode = graphIndex.nodesById.get(inEdge.from.toString());
      if (nestedNode?.kind === GraphNodeKind.WORKER) {
        const nestedPayload = resolveUpstreamPayloadForNode(
          inEdge.from.toString(),
          graph,
          graphIndex,
          context,
        );
        if (nestedPayload) {
          const binding = bindingFromWorkerNode(
            nestedNode,
            inEdge.from.toString(),
            nestedPayload,
            workers,
          );
          if (binding) {
            upstreamBySlug[binding.slug] = binding.output;
            indexOutputFields(binding.output, upstreamByField);
          }
        }
      }
    }
    indexOutputFields(payload, upstreamByField);
    return;
  }

  if (fromNode.kind === GraphNodeKind.SCRAPER) {
    upstream.push(payload);
    upstreamBySlug.scraper = payload;
    indexOutputFields(payload, upstreamByField);
    return;
  }

  if (fromNode.kind === GraphNodeKind.RESEARCH_PAPERS) {
    upstream.push(payload);
    upstreamBySlug.research_papers = payload;
    indexOutputFields(payload, upstreamByField);
    return;
  }

  if (fromNode.kind === GraphNodeKind.SWARM) {
    upstream.push(payload);
    upstreamBySlug.swarm = payload;
    indexOutputFields(payload, upstreamByField);
    return;
  }

  if (fromNode.kind === GraphNodeKind.USER_APPROVAL) {
    upstream.push(payload);
    indexOutputFields(payload, upstreamByField);
    return;
  }

  upstream.push(payload);
  indexOutputFields(payload, upstreamByField);
}

/**
 * Expression context for if/else (and future control nodes).
 * `output` / `upstream[0]` = primary predecessor; `upstreamByField` powers flat `summary` tokens.
 */
export function buildSwarmExpressionContext(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): SwarmExpressionContext {
  const upstream: Record<string, unknown>[] = [];
  const upstreamBySlug: Record<string, Record<string, unknown>> = {};
  const upstreamByField: Record<string, Record<string, unknown>> = {};

  for (const edge of graph.edges.filter((e) => e.to.toString() === nodeId)) {
    indexUpstreamFromNode(
      edge.from.toString(),
      graph,
      graphIndex,
      context,
      workers,
      upstream,
      upstreamBySlug,
      upstreamByField,
    );
  }

  const output = upstream[0] ?? {};

  return {
    goal: context.goal,
    runInput: context.runInput,
    shared: context.getShared(),
    output,
    upstream,
    upstreamBySlug,
    upstreamByField,
  };
}

/**
 * End node join — indexes every upstream worker/scraper on paths into `nodeId`
 * (matches the platform editor’s transitive variable list).
 */
export function buildEndSwarmExpressionContext(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): SwarmExpressionContext {
  const upstream: Record<string, unknown>[] = [];
  const upstreamBySlug: Record<string, Record<string, unknown>> = {};
  const upstreamByField: Record<string, Record<string, unknown>> = {};

  for (const fromNodeId of collectTransitiveSourceNodeIds(nodeId, graph)) {
    indexUpstreamFromNode(
      fromNodeId,
      graph,
      graphIndex,
      context,
      workers,
      upstream,
      upstreamBySlug,
      upstreamByField,
    );
  }

  const output = upstream[0] ?? {};

  return {
    goal: context.goal,
    runInput: context.runInput,
    shared: context.getShared(),
    output,
    upstream,
    upstreamBySlug,
    upstreamByField,
  };
}
