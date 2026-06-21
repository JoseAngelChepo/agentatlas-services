import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import { buildEndSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import {
  resolveSwarmOperand,
  type SwarmExpressionContext,
} from '../utils/evaluate-swarm-expression';
import type { GraphIndex } from '../utils/graph-index';
import type { EndNodeData, EndNodeOutput, EndOutputField } from '../types/end-node.types';

export function parseEndNodeData(data: Record<string, unknown> | undefined): EndNodeData {
  const label = typeof data?.label === 'string' ? data.label : undefined;
  const fields = Array.isArray(data?.fields)
    ? (data.fields as EndOutputField[]).filter((row) => row && typeof row === 'object')
    : [];
  return { label, fields };
}

function parseStaticValue(raw: string | undefined): unknown {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return num;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveEndFieldValue(field: EndOutputField, ctx: SwarmExpressionContext): unknown {
  const source = field.source ?? 'field';
  if (source === 'static') {
    return parseStaticValue(field.staticValue);
  }

  let path = field.valuePath?.trim() ?? '';
  if (!path) {
    return undefined;
  }

  if (source === 'runInput' && !path.startsWith('runInput.')) {
    path = `runInput.${path}`;
  }

  return resolveSwarmOperand(path, ctx);
}

export function evaluateEndNode(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
  data: EndNodeData,
): EndNodeOutput {
  const ctx = buildEndSwarmExpressionContext(graph, graphIndex, context, nodeId, workers);
  const output: Record<string, unknown> = {};

  for (const field of data.fields ?? []) {
    const key = typeof field.key === 'string' ? field.key.trim() : '';
    if (!key) {
      continue;
    }
    const value = resolveEndFieldValue(field, ctx);
    if (value !== undefined) {
      output[key] = value;
    }
  }

  return { kind: 'end', output };
}
