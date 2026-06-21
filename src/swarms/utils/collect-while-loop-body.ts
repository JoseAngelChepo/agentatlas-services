import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import { WHILE_LOOP_HANDLE } from '../types/while-node.types';
import type { GraphIndex } from '../utils/graph-index';
import { edgeEndpointNodeId } from './resolve-graph-terminals';

function outgoingFrom(
  nodeId: string,
  edges: SwarmGraph['edges'],
  graphIndex: GraphIndex,
): SwarmGraph['edges'] {
  return edges.filter((edge) => edgeEndpointNodeId(edge.from.toString(), graphIndex) === nodeId);
}

/**
 * Nodes reachable from the While `loop` port until the back-edge into `whileNodeId`
 * (exclusive). Used to reset completion state between iterations.
 */
export function collectWhileLoopBodyNodeIds(
  whileNodeId: string,
  edges: SwarmGraph['edges'],
  graphIndex: GraphIndex,
): string[] {
  const outgoing = outgoingFrom(whileNodeId, edges, graphIndex);
  const loopTargets: string[] = [];

  for (const edge of outgoing) {
    const handle = edge.sourceHandle?.trim().toLowerCase() ?? '';
    if (handle === WHILE_LOOP_HANDLE.toLowerCase()) {
      loopTargets.push(edgeEndpointNodeId(edge.to.toString(), graphIndex));
      continue;
    }
    if (!handle && outgoing.length === 1) {
      loopTargets.push(edgeEndpointNodeId(edge.to.toString(), graphIndex));
    }
  }

  const body = new Set<string>();
  const queue = [...loopTargets];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (nodeId === whileNodeId || body.has(nodeId)) {
      continue;
    }
    body.add(nodeId);

    for (const edge of outgoingFrom(nodeId, edges, graphIndex)) {
      const childId = edgeEndpointNodeId(edge.to.toString(), graphIndex);
      if (childId === whileNodeId) {
        continue;
      }
      if (!body.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return [...body];
}
