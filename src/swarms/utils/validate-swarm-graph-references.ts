import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { UpsertSwarmGraphDto } from '../dto/upsert-swarm-graph.dto';
import { parseSwarmNodeData } from '../orchestrator/evaluate-swarm-node';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmDocument } from '../schemas/swarm.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { WorkerNodeType } from '../types/worker-node-type.enum';
import { buildGraphIndex, graphNodeId, resolveNodeKind } from './graph-index';

export const MAX_SWARM_NESTING_DEPTH = 3;

type GraphLoader = (swarmId: string) => Promise<SwarmGraph | null>;

type SwarmLoader = (swarmId: string) => Promise<SwarmDocument>;

function dtoToGraphNodes(dto: UpsertSwarmGraphDto): SwarmGraph['nodes'] {
  return dto.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    workerId: n.workerId ? new Types.ObjectId(n.workerId) : undefined,
    type: n.type ?? WorkerNodeType.WORKER,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: n.data,
  }));
}

function draftGraph(swarmId: string, dto: UpsertSwarmGraphDto): SwarmGraph {
  return {
    swarmId: new Types.ObjectId(swarmId),
    nodes: dtoToGraphNodes(dto),
    edges: [],
    entryNode: dto.entryNode,
    exitNode: dto.exitNode,
  };
}

export function collectReferencedSwarmIdsFromGraph(graph: Pick<SwarmGraph, 'nodes'>): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (resolveNodeKind(node) !== GraphNodeKind.SWARM) {
      continue;
    }
    const swarmId = parseSwarmNodeData(node.data).swarmId;
    if (swarmId && Types.ObjectId.isValid(swarmId)) {
      ids.add(swarmId);
    }
  }
  return [...ids];
}

export function graphContainsUserApproval(graph: Pick<SwarmGraph, 'nodes'>): boolean {
  return graph.nodes.some((node) => resolveNodeKind(node) === GraphNodeKind.USER_APPROVAL);
}

function validateSwarmNodeShape(
  rootSwarmId: string,
  dto: UpsertSwarmGraphDto,
): Map<string, string> {
  const refs = new Map<string, string>();

  for (const node of dto.nodes) {
    const kind = node.kind ?? GraphNodeKind.WORKER;
    if (kind !== GraphNodeKind.SWARM) {
      continue;
    }

    const nodeId = node.id?.trim();
    if (!nodeId) {
      throw new BadRequestException('Sub-swarm nodes must have a stable graph node id');
    }

    const swarmId = parseSwarmNodeData(node.data).swarmId ?? '';
    if (!swarmId || !Types.ObjectId.isValid(swarmId)) {
      throw new BadRequestException(`Sub-swarm node "${nodeId}" requires data.swarmId`);
    }
    if (swarmId === rootSwarmId) {
      throw new BadRequestException('A swarm cannot reference itself as a sub-swarm');
    }

    refs.set(nodeId, swarmId);
  }

  return refs;
}

async function maxNestingDepthFrom(
  swarmId: string,
  loadGraph: GraphLoader,
  stack: Set<string>,
): Promise<number> {
  if (stack.has(swarmId)) {
    throw new BadRequestException('Circular sub-swarm reference detected');
  }

  const graph = await loadGraph(swarmId);
  if (!graph) {
    return 0;
  }

  const refs = collectReferencedSwarmIdsFromGraph(graph);
  if (refs.length === 0) {
    return 0;
  }

  const nextStack = new Set(stack);
  nextStack.add(swarmId);

  let maxChild = 0;
  for (const refId of refs) {
    const childDepth = await maxNestingDepthFrom(refId, loadGraph, nextStack);
    maxChild = Math.max(maxChild, 1 + childDepth);
  }
  return maxChild;
}

async function assertNoUserApprovalInReferencedSwarms(
  swarmIds: string[],
  loadGraph: GraphLoader,
  visited = new Set<string>(),
): Promise<void> {
  for (const swarmId of swarmIds) {
    if (visited.has(swarmId)) {
      continue;
    }
    visited.add(swarmId);

    const graph = await loadGraph(swarmId);
    if (!graph) {
      throw new BadRequestException(`Referenced swarm "${swarmId}" has no saved graph`);
    }
    if (graphContainsUserApproval(graph)) {
      throw new BadRequestException(
        `Referenced swarm "${swarmId}" contains user_approval nodes; use user_input with parent bubble instead`,
      );
    }

    const nested = collectReferencedSwarmIdsFromGraph(graph);
    if (nested.length > 0) {
      await assertNoUserApprovalInReferencedSwarms(nested, loadGraph, visited);
    }
  }
}

export async function validateSwarmGraphReferences(params: {
  rootSwarmId: string;
  dto: UpsertSwarmGraphDto;
  userId: string;
  loadGraph: GraphLoader;
  loadSwarm: SwarmLoader;
  assertCanRun: (userId: string, swarmId: string) => Promise<SwarmDocument>;
}): Promise<void> {
  const directRefs = validateSwarmNodeShape(params.rootSwarmId, params.dto);
  if (directRefs.size === 0) {
    return;
  }

  const rootGraph: Pick<SwarmGraph, 'nodes'> = { nodes: dtoToGraphNodes(params.dto) };
  const allReferenced = new Set<string>([...directRefs.values()]);

  for (const refId of collectReferencedSwarmIdsFromGraph(rootGraph)) {
    allReferenced.add(refId);
  }

  for (const swarmId of allReferenced) {
    try {
      await params.loadSwarm(swarmId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException(`Referenced swarm "${swarmId}" not found`);
      }
      throw err;
    }

    try {
      await params.assertCanRun(params.userId, swarmId);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new BadRequestException(
          `You do not have access to reference swarm "${swarmId}" as a sub-swarm`,
        );
      }
      throw err;
    }
  }

  const rootDepth = await maxNestingDepthFrom(
    params.rootSwarmId,
    async (swarmId) => {
      if (swarmId === params.rootSwarmId) {
        return draftGraph(params.rootSwarmId, params.dto);
      }
      return params.loadGraph(swarmId);
    },
    new Set(),
  );

  if (rootDepth > MAX_SWARM_NESTING_DEPTH) {
    throw new BadRequestException(
      `Sub-swarm nesting exceeds maximum depth of ${MAX_SWARM_NESTING_DEPTH}`,
    );
  }

  await assertNoUserApprovalInReferencedSwarms([...allReferenced], params.loadGraph);
}

/** Validates graph node ids exist for edges (including sub-swarm nodes). */
export function validateGraphNodeIds(dto: UpsertSwarmGraphDto): void {
  const index = buildGraphIndex(
    draftGraph(new Types.ObjectId().toString(), dto),
  );

  for (const edge of dto.edges) {
    const from = edge.from.toString();
    const to = edge.to.toString();
    if (!index.nodesById.has(from)) {
      throw new BadRequestException(`Edge source "${from}" is not a graph node`);
    }
    if (!index.nodesById.has(to)) {
      throw new BadRequestException(`Edge target "${to}" is not a graph node`);
    }
  }

  for (const node of dto.nodes) {
    try {
      graphNodeId({
        id: node.id,
        workerId: node.workerId ? new Types.ObjectId(node.workerId) : undefined,
        type: node.type ?? WorkerNodeType.WORKER,
        kind: node.kind,
        position: { x: 0, y: 0 },
        data: node.data,
      });
    } catch {
      throw new BadRequestException('Every graph node must have id or workerId');
    }
  }
}
