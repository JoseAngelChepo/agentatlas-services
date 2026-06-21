import type { AgentWorkerRunInput } from '../../swarms/context/swarm-context.types';
import type { SwarmExpressionContext } from '../../swarms/utils/evaluate-swarm-expression';
import { indexOutputFields } from '../../swarms/utils/swarm-output-fields';

function slugifyWorkerName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.length > 0 ? cleaned : 'worker';
}

/** Builds the same expression context shape as if/else nodes, from a worker run payload. */
export function buildWorkerExpressionContext(
  input: AgentWorkerRunInput,
): SwarmExpressionContext {
  const upstream = input.upstream ?? [];
  const upstreamBySlug: Record<string, Record<string, unknown>> = {};
  const upstreamByField: Record<string, Record<string, unknown>> = {};
  const meta = input.upstreamMeta ?? [];

  upstream.forEach((payload, index) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const record = payload as Record<string, unknown>;
    const source = meta[index];
    if (source) {
      if (source.ref) {
        upstreamBySlug[source.ref] = record;
      }
      if (source.nodeId) {
        upstreamBySlug[source.nodeId] = record;
      }
      upstreamBySlug[source.workerId] = record;
      upstreamBySlug[slugifyWorkerName(source.workerName)] = record;
    }
    indexOutputFields(record, upstreamByField);
  });

  return {
    goal: input.goal ?? '',
    runInput: input.runInput ?? {},
    shared: input.shared ?? {},
    output: upstream[0] ?? {},
    upstream,
    upstreamBySlug,
    upstreamByField,
  };
}
