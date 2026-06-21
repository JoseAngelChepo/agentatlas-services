import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmGraphNode } from '../schemas/swarm-graph.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type { GraphIndex } from './graph-index';
import { graphNodeId } from './graph-index';

export const START_CONTROL_KIND = 'start';

export function isStartGraphNode(node: SwarmGraphNode): boolean {
  const type = (node.type as string | undefined)?.toLowerCase();
  if (type === GraphNodeKind.START) {
    return true;
  }
  const data = node.data;
  if (data && typeof data === 'object') {
    const controlKind = (data as { controlKind?: string }).controlKind;
    if (controlKind === START_CONTROL_KIND) {
      return true;
    }
  }
  return false;
}

export function findStartGraphNode(
  graph: SwarmGraph,
  graphIndex?: GraphIndex,
): { id: string; raw: SwarmGraphNode } | null {
  if (graphIndex) {
    for (const indexed of graphIndex.nodesById.values()) {
      if (indexed.kind === GraphNodeKind.START) {
        return { id: indexed.id, raw: indexed.raw };
      }
    }
    return null;
  }

  for (const node of graph.nodes) {
    if (isStartGraphNode(node)) {
      return { id: graphNodeId(node), raw: node };
    }
  }
  return null;
}

/**
 * Graph node ids wired from Start.
 * Live canvas edges win over persisted `data.downstreamNodeIds` so disconnecting
 * a wire in the UI does not leave ghost scheduling edges.
 */
export function listStartDownstreamNodeIds(
  graph: SwarmGraph,
  startNodeId: string,
): string[] {
  const fromEdges = graph.edges
    .filter((e) => e.from.toString() === startNodeId)
    .map((e) => e.to.toString());
  if (fromEdges.length > 0) {
    return fromEdges;
  }
  return parseDownstreamNodeIds(
    graph.nodes.find((n) => graphNodeId(n) === startNodeId)?.data,
  );
}

function parseDownstreamNodeIds(data: Record<string, unknown> | undefined): string[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const raw = (data as { downstreamNodeIds?: unknown }).downstreamNodeIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
