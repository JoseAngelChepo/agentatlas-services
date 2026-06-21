import type { SwarmGraphNode } from '../schemas/swarm-graph.schema';

export function readGraphNodeRef(node: SwarmGraphNode | undefined): string | null {
  const raw = node?.data?.ref;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Fallback when legacy graphs have no `data.ref`. */
export function slugifyNodeId(nodeId: string): string {
  const cleaned = nodeId.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.length > 0 ? cleaned : 'node';
}

export function upstreamRefForIndexedNode(
  fromNodeId: string,
  data: Record<string, unknown> | undefined,
  workerName: string,
): string {
  const raw = data?.ref;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  const cleaned = workerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length > 0) {
    return cleaned.slice(0, 28);
  }
  return slugifyNodeId(fromNodeId).slice(0, 28);
}
