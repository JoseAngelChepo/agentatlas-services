import type { SwarmGraph } from '../schemas/swarm-graph.schema';

function pairKey(from: string, to: string): string {
  return `${from}|${to}`;
}

/** Normalizes legacy `case-case-*` to `case-*` for dedup keys. */
function ifElseBranchKey(sourceHandle: string): string {
  const h = sourceHandle.trim().toLowerCase();
  if (h.startsWith('case-case-')) {
    return h.slice(5);
  }
  return h;
}

/**
 * Collapses duplicate If/else wires on the same target (e.g. `case-case-*` + `case-*`).
 */
export function dedupeSwarmGraphEdges(edges: SwarmGraph['edges']): SwarmGraph['edges'] {
  const byPair = new Map<string, SwarmGraph['edges']>();

  for (const edge of edges) {
    const key = pairKey(edge.from.toString(), edge.to.toString());
    const group = byPair.get(key) ?? [];
    group.push(edge);
    byPair.set(key, group);
  }

  const result: SwarmGraph['edges'] = [];

  for (const group of byPair.values()) {
    const branchEdges = group.filter((edge) => {
      const handle = edge.sourceHandle?.trim() ?? '';
      return handle.startsWith('case-') || handle === 'else';
    });
    const rest = group.filter((edge) => !branchEdges.includes(edge));

    result.push(...rest);

    if (branchEdges.length === 0) {
      continue;
    }

    const byBranch = new Map<string, SwarmGraph['edges'][number]>();
    for (const edge of branchEdges) {
      const handle = edge.sourceHandle?.trim() ?? 'else';
      const branch = ifElseBranchKey(handle);
      const existing = byBranch.get(branch);
      if (!existing) {
        byBranch.set(branch, edge);
        continue;
      }
      const existingHandle = existing.sourceHandle?.trim() ?? '';
      const prefer =
        !existingHandle.startsWith('case-case-') && handle.startsWith('case-case-')
          ? existing
          : existingHandle.startsWith('case-case-') && !handle.startsWith('case-case-')
            ? { ...edge, sourceHandle: handle }
            : existing;
      byBranch.set(branch, prefer);
    }

    result.push(...byBranch.values());
  }

  return result;
}
