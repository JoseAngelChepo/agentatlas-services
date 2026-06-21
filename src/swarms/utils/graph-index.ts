import { Types } from 'mongoose';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmGraphNode } from '../schemas/swarm-graph.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type { IfElseCase, IfElseNodeData } from '../types/if-else-node.types';
import type { WhileNodeData } from '../types/while-node.types';
import { DEFAULT_WHILE_MAX_ITERATIONS } from '../types/while-node.types';
import type { UserApprovalNodeData } from '../types/user-approval-node.types';
import type { UserInputNodeData } from '../types/user-input-node.types';
import { isStartGraphNode } from './start-node';

export type IndexedGraphNode = {
  id: string;
  kind: GraphNodeKind;
  workerId?: Types.ObjectId;
  data?: Record<string, unknown>;
  raw: SwarmGraphNode;
};

export type GraphIndex = {
  nodesById: Map<string, IndexedGraphNode>;
  /** Worker id → graph node id (first match). */
  workerNodeIdByWorkerKey: Map<string, string>;
};

export function resolveNodeKind(node: SwarmGraphNode): GraphNodeKind {
  if (isStartGraphNode(node)) {
    return GraphNodeKind.START;
  }

  const explicitKind = node.kind as GraphNodeKind | undefined;
  if (
    explicitKind === GraphNodeKind.IF_ELSE ||
    explicitKind === GraphNodeKind.WHILE ||
    explicitKind === GraphNodeKind.SCRAPER ||
    explicitKind === GraphNodeKind.SWARM ||
    explicitKind === GraphNodeKind.START ||
    explicitKind === GraphNodeKind.USER_APPROVAL ||
    explicitKind === GraphNodeKind.USER_INPUT ||
    explicitKind === GraphNodeKind.END
  ) {
    return explicitKind;
  }
  if (explicitKind === GraphNodeKind.WORKER) {
    return GraphNodeKind.WORKER;
  }

  const type = (node.type as string | undefined)?.toLowerCase();
  if (type === GraphNodeKind.IF_ELSE) {
    return GraphNodeKind.IF_ELSE;
  }
  if (type === GraphNodeKind.WHILE) {
    return GraphNodeKind.WHILE;
  }
  if (type === GraphNodeKind.SCRAPER) {
    return GraphNodeKind.SCRAPER;
  }
  if (type === GraphNodeKind.SWARM) {
    return GraphNodeKind.SWARM;
  }
  if (type === GraphNodeKind.USER_APPROVAL || type === 'userApproval') {
    return GraphNodeKind.USER_APPROVAL;
  }
  if (type === GraphNodeKind.USER_INPUT || type === 'userInput') {
    return GraphNodeKind.USER_INPUT;
  }
  if (type === GraphNodeKind.END) {
    return GraphNodeKind.END;
  }
  const dataKind = (node.data as { kind?: string } | undefined)?.kind;
  if (dataKind === GraphNodeKind.IF_ELSE) {
    return GraphNodeKind.IF_ELSE;
  }
  if (dataKind === GraphNodeKind.WHILE) {
    return GraphNodeKind.WHILE;
  }
  if (dataKind === GraphNodeKind.SCRAPER) {
    return GraphNodeKind.SCRAPER;
  }
  if (dataKind === GraphNodeKind.SWARM) {
    return GraphNodeKind.SWARM;
  }
  if (dataKind === GraphNodeKind.USER_APPROVAL || dataKind === 'userApproval') {
    return GraphNodeKind.USER_APPROVAL;
  }
  if (dataKind === GraphNodeKind.USER_INPUT || dataKind === 'userInput') {
    return GraphNodeKind.USER_INPUT;
  }
  if (dataKind === GraphNodeKind.END) {
    return GraphNodeKind.END;
  }
  return GraphNodeKind.WORKER;
}

export function parseUserApprovalNodeData(
  data: Record<string, unknown> | undefined,
): UserApprovalNodeData {
  const name = typeof data?.name === 'string' ? data.name : undefined;
  const message = typeof data?.message === 'string' ? data.message : undefined;
  const assignee =
    typeof data?.assignee === 'string' && data.assignee.trim()
      ? (data.assignee.trim() as UserApprovalNodeData['assignee'])
      : undefined;
  return { name, message, assignee };
}

export function parseUserInputNodeData(
  data: Record<string, unknown> | undefined,
): UserInputNodeData {
  const name = typeof data?.name === 'string' ? data.name : undefined;
  const question = typeof data?.question === 'string' ? data.question : undefined;
  const suggestedAnswers = Array.isArray(data?.suggestedAnswers)
    ? data!.suggestedAnswers.filter((item): item is string => typeof item === 'string')
    : undefined;
  return { name, question, suggestedAnswers };
}

export function graphNodeId(node: SwarmGraphNode): string {
  if (node.id?.trim()) {
    return node.id.trim();
  }
  if (node.workerId) {
    return node.workerId.toString();
  }
  throw new Error('Graph node is missing both id and workerId');
}

export function buildGraphIndex(graph: SwarmGraph): GraphIndex {
  const nodesById = new Map<string, IndexedGraphNode>();
  const workerNodeIdByWorkerKey = new Map<string, string>();

  for (const raw of graph.nodes) {
    const id = graphNodeId(raw);
    const kind = resolveNodeKind(raw);
    const indexed: IndexedGraphNode = {
      id,
      kind,
      workerId: raw.workerId,
      data: raw.data,
      raw,
    };
    nodesById.set(id, indexed);
    if (kind === GraphNodeKind.WORKER && raw.workerId) {
      const key = raw.workerId.toString();
      if (!workerNodeIdByWorkerKey.has(key)) {
        workerNodeIdByWorkerKey.set(key, id);
      }
    }
  }

  return { nodesById, workerNodeIdByWorkerKey };
}

export function parseIfElseNodeData(data: Record<string, unknown> | undefined): IfElseNodeData {
  const casesRaw = data?.cases;
  if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
    return { cases: [{ id: 'default', name: '', condition: '' }] };
  }
  const cases: IfElseCase[] = [];
  for (const item of casesRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `case-${Date.now()}`;
    const name = typeof row.name === 'string' ? row.name : '';
    const condition = typeof row.condition === 'string' ? row.condition : '';
    cases.push({ id, name, condition });
  }
  return { cases: cases.length > 0 ? cases : [{ id: 'default', name: '', condition: '' }] };
}

export function parseWhileNodeData(data: Record<string, unknown> | undefined): WhileNodeData {
  const condition = typeof data?.condition === 'string' ? data.condition : '';
  const useCode = data?.useCode === true || data?.useCustom === true;
  const maxRaw = data?.maxIterations;
  const maxIterations =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.min(Math.floor(maxRaw), 500)
      : DEFAULT_WHILE_MAX_ITERATIONS;
  return {
    condition,
    ...(useCode ? { useCode: true } : {}),
    maxIterations,
  };
}

export function workerNodeIdForWorkerKey(index: GraphIndex, workerKey: string): string {
  return index.workerNodeIdByWorkerKey.get(workerKey) ?? workerKey;
}

export function collectAllNodeIds(index: GraphIndex): string[] {
  return [...index.nodesById.keys()];
}

export function collectWorkerIdsFromGraph(graph: SwarmGraph): Types.ObjectId[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (resolveNodeKind(node) === GraphNodeKind.WORKER && node.workerId) {
      ids.add(node.workerId.toString());
    }
  }
  for (const edge of graph.edges) {
    const from = edge.from.toString();
    const to = edge.to.toString();
    if (Types.ObjectId.isValid(from)) ids.add(from);
    if (Types.ObjectId.isValid(to)) ids.add(to);
  }
  const entryKey = graph.entryNode?.toString?.()?.trim() ?? '';
  const exitKey = graph.exitNode?.toString?.()?.trim() ?? '';
  if (entryKey && Types.ObjectId.isValid(entryKey)) {
    ids.add(entryKey);
  }
  if (exitKey && Types.ObjectId.isValid(exitKey)) {
    ids.add(exitKey);
  }
  return [...ids].map((id) => new Types.ObjectId(id));
}
