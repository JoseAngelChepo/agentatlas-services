import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type { GraphIndex } from './graph-index';
import { edgeEndpointNodeId, resolveExitNodeId } from './resolve-graph-terminals';
import { findStartGraphNode, listStartDownstreamNodeIds } from './start-node';

/** End nodes with at least one incoming wire and no outgoing wires. */
export function findSinkEndNodeIds(graph: SwarmGraph, graphIndex: GraphIndex): string[] {
  const ends: string[] = [];
  const start = findStartGraphNode(graph, graphIndex);
  const startDownstream = new Set(
    start
      ? listStartDownstreamNodeIds(graph, start.id).map((id) =>
          edgeEndpointNodeId(id, graphIndex),
        )
      : [],
  );

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
      ends.push(nodeId);
    }
  }

  return ends;
}

export function pickPreferredEndNodeId(endNodeIds: string[], graphIndex: GraphIndex): string | null {
  if (endNodeIds.length === 0) {
    return null;
  }
  if (endNodeIds.length === 1) {
    return endNodeIds[0] ?? null;
  }

  const sorted = [...endNodeIds].sort((a, b) => {
    const pa = graphIndex.nodesById.get(a)?.raw.position ?? { x: 0, y: 0 };
    const pb = graphIndex.nodesById.get(b)?.raw.position ?? { x: 0, y: 0 };
    if (pa.y !== pb.y) {
      return pb.y - pa.y;
    }
    return pa.x - pb.x;
  });
  return sorted[0] ?? null;
}

export function resolveRunCompletion(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
): { completionNodeId: string; returnsEndOutput: boolean } {
  const endId = pickPreferredEndNodeId(findSinkEndNodeIds(graph, graphIndex), graphIndex);
  if (endId) {
    return { completionNodeId: endId, returnsEndOutput: true };
  }
  return {
    completionNodeId: resolveExitNodeId(graph, graphIndex),
    returnsEndOutput: false,
  };
}
