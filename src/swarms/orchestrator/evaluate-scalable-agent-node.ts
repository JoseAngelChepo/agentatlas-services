import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { GraphIndex } from '../utils/graph-index';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import { resolveSwarmOperand } from '../utils/evaluate-swarm-expression';
import { plainSubdocument } from '../../common/utils/plain-mongoose';

export type ScalableAgentNodeData = {
  scalable?: boolean;
  /** Wrapper key for scalable output array (defaults to {@link SCALABLE_AGENT_OUTPUT_KEY}). */
  outputArrayKey?: string;
  /** Resolved via {@link resolveSwarmOperand} — e.g. `items`, `runInput.tasks`, `upstream.splitter.items`. */
  inputArrayExpression?: string;
  /** @deprecated Prefer `inputArrayExpression`. */
  inputArrayPath?: string;
};

/** Graph node output key holding `Array<worker output schema>` after a scalable run. */
export const SCALABLE_AGENT_OUTPUT_KEY = 'outputs';

export function readScalableOutputArrayKey(
  data: Pick<ScalableAgentNodeData, 'outputArrayKey'> | undefined,
): string {
  const raw = data?.outputArrayKey;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return SCALABLE_AGENT_OUTPUT_KEY;
}

export function buildScalableWorkerOutput(
  shardOutputs: Record<string, unknown>[],
  outputArrayKey = SCALABLE_AGENT_OUTPUT_KEY,
): Record<string, unknown> {
  return { [outputArrayKey]: shardOutputs };
}

export function parseScalableAgentNodeData(
  data: Record<string, unknown> | undefined,
): ScalableAgentNodeData {
  const plain = plainSubdocument<Record<string, unknown>>(data) ?? data;
  const inputArrayExpression =
    typeof plain?.inputArrayExpression === 'string' && plain.inputArrayExpression.trim()
      ? plain.inputArrayExpression.trim()
      : typeof plain?.inputArrayPath === 'string' && plain.inputArrayPath.trim()
        ? plain.inputArrayPath.trim()
        : undefined;
  const outputArrayKey =
    typeof plain?.outputArrayKey === 'string' && plain.outputArrayKey.trim()
      ? plain.outputArrayKey.trim()
      : undefined;

  return {
    scalable: plain?.scalable === true,
    outputArrayKey,
    inputArrayExpression,
    inputArrayPath:
      typeof plain?.inputArrayPath === 'string' && plain.inputArrayPath.trim()
        ? plain.inputArrayPath.trim()
        : undefined,
  };
}

export function expressionForScalableArrayConfig(config: ScalableAgentNodeData): string {
  return config.inputArrayExpression?.trim() || config.inputArrayPath?.trim() || 'items';
}

/** Last segment of the array expression — e.g. `papers`, `items`. Null for `runInput.*`. */
export function rootFieldFromScalableArrayExpression(expression: string): string | null {
  const expr = expression.trim();
  if (!expr || expr.startsWith('runInput.')) {
    return null;
  }
  const root = expr.includes('.') ? expr.split('.').pop() : expr;
  return root?.trim() || null;
}

/** Resolves the fan-out array from a swarm expression (upstream / runInput / shared). */
export function resolveScalableInputArray(
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
  config: ScalableAgentNodeData,
): unknown[] {
  const expression = expressionForScalableArrayConfig(config);
  const exprCtx = buildSwarmExpressionContext(graph, graphIndex, context, nodeId, workers);
  const value = resolveSwarmOperand(expression, exprCtx);

  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(
    `Scalable agent ${nodeId}: "${expression}" did not resolve to an array (got ${value === null ? 'null' : typeof value})`,
  );
}
