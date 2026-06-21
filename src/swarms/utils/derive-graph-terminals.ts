/** Worker-level edge (Mongo worker ids), not React Flow node ids. */
export type SwarmWorkerEdge = {
  from: string;
  to: string;
};

export type SwarmEntryExit = {
  entryNode: string | null;
  exitNode: string | null;
};

function sortByCanvasPosition(
  workerIds: string[],
  positions: Map<string, { x: number; y: number }>,
  order: 'top-first' | 'bottom-first',
): string[] {
  return [...workerIds].sort((a, b) => {
    const pa = positions.get(a) ?? { x: 0, y: 0 };
    const pb = positions.get(b) ?? { x: 0, y: 0 };
    if (pa.y !== pb.y) {
      return order === 'top-first' ? pa.y - pb.y : pb.y - pa.y;
    }
    return pa.x - pb.x;
  });
}

/**
 * Infers orchestrator entry/exit worker ids from the directed worker graph.
 * Mirrors `agentatlas-platform/src/lib/derive-swarm-entry-exit.ts`.
 */
export function deriveEntryExitFromGraph(
  workerIds: string[],
  edges: SwarmWorkerEdge[],
  positions: Map<string, { x: number; y: number }> = new Map(),
): SwarmEntryExit {
  if (workerIds.length === 0) {
    return { entryNode: null, exitNode: null };
  }
  if (workerIds.length === 1) {
    const only = workerIds[0] ?? null;
    return { entryNode: only, exitNode: only };
  }

  const onCanvas = new Set(workerIds);
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const id of workerIds) {
    inDegree.set(id, 0);
    outDegree.set(id, 0);
  }

  const wireEdges: SwarmWorkerEdge[] = [];
  for (const edge of edges) {
    if (!onCanvas.has(edge.from) || !onCanvas.has(edge.to)) {
      continue;
    }
    wireEdges.push(edge);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
  }

  if (wireEdges.length === 0) {
    const ordered = sortByCanvasPosition(workerIds, positions, 'top-first');
    return {
      entryNode: ordered[0] ?? null,
      exitNode: ordered[ordered.length - 1] ?? null,
    };
  }

  const sources = workerIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const sinks = workerIds.filter((id) => (outDegree.get(id) ?? 0) === 0);

  const entryNode =
    sources.length > 0
      ? sortByCanvasPosition(sources, positions, 'top-first')[0]
      : sortByCanvasPosition(workerIds, positions, 'top-first')[0];

  let exitNode: string | undefined;
  if (sinks.length === 1) {
    exitNode = sinks[0];
  } else if (sinks.length > 1) {
    const maxIn = Math.max(...sinks.map((id) => inDegree.get(id) ?? 0));
    const joinSinks = sinks.filter((id) => (inDegree.get(id) ?? 0) === maxIn);
    exitNode = sortByCanvasPosition(joinSinks, positions, 'bottom-first')[0];
  } else {
    exitNode = sortByCanvasPosition(workerIds, positions, 'bottom-first')[0];
  }

  return {
    entryNode: entryNode ?? null,
    exitNode: exitNode ?? null,
  };
}
