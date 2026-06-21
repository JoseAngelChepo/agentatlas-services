import type { Types } from 'mongoose';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import { plainSubdocument } from '../../common/utils/plain-mongoose';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { deriveEntryExitFromGraph, type SwarmWorkerEdge } from './derive-graph-terminals';
import { buildGraphIndex, workerNodeIdForWorkerKey, type GraphIndex } from './graph-index';
import { findStartGraphNode, listStartDownstreamNodeIds } from './start-node';

function readStoredTerminal(stored: string | Types.ObjectId | null | undefined): string | null {
  if (stored == null) {
    return null;
  }
  const key = stored.toString().trim();
  return key.length > 0 ? key : null;
}

function workerIdsOnGraph(graphIndex: GraphIndex): string[] {
  const ids: string[] = [];
  for (const node of graphIndex.nodesById.values()) {
    if (node.kind === GraphNodeKind.WORKER && node.workerId) {
      ids.push(node.workerId.toString());
    }
  }
  return ids;
}

function workerPositions(graphIndex: GraphIndex): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graphIndex.nodesById.values()) {
    if (node.kind !== GraphNodeKind.WORKER || !node.workerId) {
      continue;
    }
    positions.set(node.workerId.toString(), {
      x: node.raw.position?.x ?? 0,
      y: node.raw.position?.y ?? 0,
    });
  }
  return positions;
}

/** Maps graph edges to worker-level edges (node id → worker id). */
export function buildWorkerLevelEdges(graph: SwarmGraph, graphIndex: GraphIndex): SwarmWorkerEdge[] {
  const edges: SwarmWorkerEdge[] = [];

  for (const edge of graph.edges) {
    const fromNode = graphIndex.nodesById.get(edge.from.toString());
    const toNode = graphIndex.nodesById.get(edge.to.toString());
    const from =
      fromNode?.kind === GraphNodeKind.WORKER && fromNode.workerId
        ? fromNode.workerId.toString()
        : null;
    const to =
      toNode?.kind === GraphNodeKind.WORKER && toNode.workerId ? toNode.workerId.toString() : null;
    if (!from || !to) {
      continue;
    }
    edges.push({ from, to });
  }

  return edges;
}

export function deriveGraphTerminals(
  graph: SwarmGraph,
  graphIndex?: GraphIndex,
): { entryNode: string | null; exitNode: string | null } {
  const index = graphIndex ?? buildGraphIndex(graph);
  const workerIds = workerIdsOnGraph(index);
  return deriveEntryExitFromGraph(workerIds, buildWorkerLevelEdges(graph, index), workerPositions(index));
}

function resolveSinkEndNodeKey(graph: SwarmGraph, graphIndex: GraphIndex): string | null {
  const start = findStartGraphNode(graph, graphIndex);
  const startDownstream = new Set(
    start
      ? listStartDownstreamNodeIds(graph, start.id).map((id) =>
          edgeEndpointNodeId(id, graphIndex),
        )
      : [],
  );

  const sinkEnds: string[] = [];
  for (const [nodeId, node] of graphIndex.nodesById) {
    if (node.kind !== GraphNodeKind.END) {
      continue;
    }
    const hasIncoming =
      startDownstream.has(nodeId) ||
      graph.edges.some(
        (edge) => edgeEndpointNodeId(edge.to.toString(), graphIndex) === nodeId,
      );
    const hasOutgoing = graph.edges.some(
      (edge) => edgeEndpointNodeId(edge.from.toString(), graphIndex) === nodeId,
    );
    if (hasIncoming && !hasOutgoing) {
      sinkEnds.push(nodeId);
    }
  }

  if (sinkEnds.length === 1) {
    return sinkEnds[0] ?? null;
  }
  if (sinkEnds.length > 1) {
    const sorted = [...sinkEnds].sort((a, b) => {
      const pa = graphIndex.nodesById.get(a)?.raw.position ?? { x: 0, y: 0 };
      const pb = graphIndex.nodesById.get(b)?.raw.position ?? { x: 0, y: 0 };
      if (pa.y !== pb.y) {
        return pb.y - pa.y;
      }
      return pa.x - pb.x;
    });
    return sorted[0] ?? null;
  }

  for (const [nodeId, node] of graphIndex.nodesById) {
    if (node.kind === GraphNodeKind.END) {
      return nodeId;
    }
  }
  return null;
}

/** Exit worker for the run loop — topology first, then stored `graph.exitNode`. */
export function resolveExitWorkerKey(graph: SwarmGraph, graphIndex: GraphIndex): string {
  const derived = deriveGraphTerminals(graph, graphIndex).exitNode;
  if (derived) {
    return derived;
  }
  const endKey = resolveSinkEndNodeKey(graph, graphIndex);
  if (endKey) {
    return endKey;
  }
  const stored = readStoredTerminal(graph.exitNode);
  if (stored) {
    return stored;
  }
  throw new Error('Swarm graph is missing exitNode');
}

export function resolveExitNodeId(graph: SwarmGraph, graphIndex: GraphIndex): string {
  return workerNodeIdForWorkerKey(graphIndex, resolveExitWorkerKey(graph, graphIndex));
}

function firstWorkerKeyDownstreamOfStart(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  startNodeId: string,
): string | null {
  for (const targetId of listStartDownstreamNodeIds(graph, startNodeId)) {
    const node = graphIndex.nodesById.get(edgeEndpointNodeId(targetId, graphIndex));
    if (node?.kind === GraphNodeKind.WORKER && node.workerId) {
      return node.workerId.toString();
    }
  }
  return null;
}

function firstNodeKeyDownstreamOfStart(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  startNodeId: string,
): string | null {
  for (const targetId of listStartDownstreamNodeIds(graph, startNodeId)) {
    const nodeId = edgeEndpointNodeId(targetId, graphIndex);
    if (graphIndex.nodesById.has(nodeId)) {
      return nodeId;
    }
  }
  return null;
}

/** Entry worker hint (fail-fast); when Start exists, only workers wired from Start count. */
export function resolveEntryWorkerKey(graph: SwarmGraph, graphIndex: GraphIndex): string {
  const start = findStartGraphNode(graph, graphIndex);
  if (start) {
    const fromStartWorker = firstWorkerKeyDownstreamOfStart(graph, graphIndex, start.id);
    if (fromStartWorker) {
      return fromStartWorker;
    }
    const fromStartNode = firstNodeKeyDownstreamOfStart(graph, graphIndex, start.id);
    if (fromStartNode) {
      return fromStartNode;
    }
  }

  const derived = deriveGraphTerminals(graph, graphIndex).entryNode;
  if (derived) {
    return derived;
  }
  const endKey = resolveSinkEndNodeKey(graph, graphIndex);
  if (endKey) {
    return endKey;
  }
  const stored = readStoredTerminal(graph.entryNode);
  if (stored) {
    return stored;
  }
  throw new Error('Swarm graph is missing entryNode');
}

export function resolveEntryNodeId(graph: SwarmGraph, graphIndex: GraphIndex): string {
  return workerNodeIdForWorkerKey(graphIndex, resolveEntryWorkerKey(graph, graphIndex));
}

/** Normalizes edge endpoint to a graph node id when legacy saves used worker ObjectIds. */
export function edgeEndpointNodeId(endpoint: string, graphIndex: GraphIndex): string {
  const key = endpoint.toString();
  if (graphIndex.nodesById.has(key)) {
    return key;
  }
  return workerNodeIdForWorkerKey(graphIndex, key);
}

export function normalizeGraphEdgeEndpoints(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
): SwarmGraph['edges'] {
  return graph.edges
    .filter((edge) => edge?.from != null && edge?.to != null)
    .map((edge) => {
      const plain =
        plainSubdocument<SwarmGraph['edges'][number]>(edge) ??
        (edge as SwarmGraph['edges'][number]);
      return {
        ...plain,
        from: edgeEndpointNodeId(plain.from.toString(), graphIndex),
        to: edgeEndpointNodeId(plain.to.toString(), graphIndex),
      };
    });
}
