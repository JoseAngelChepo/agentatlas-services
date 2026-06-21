import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import {
  WHILE_DONE_HANDLE,
  WHILE_LOOP_HANDLE,
  type WhileNodeOutput,
} from '../types/while-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import { evaluateSwarmExpression } from '../utils/evaluate-swarm-expression';
import { parseWhileNodeData, type GraphIndex } from '../utils/graph-index';

export function evaluateWhileNode(
  graph: SwarmGraph,
  index: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
  iteration: number,
): WhileNodeOutput {
  const node = index.nodesById.get(nodeId);
  const data = parseWhileNodeData(node?.data);
  const condition = data.condition?.trim() ?? '';
  const exprCtx = buildSwarmExpressionContext(graph, index, context, nodeId, workers);

  const conditionResult = condition ? evaluateSwarmExpression(condition, exprCtx) : false;

  return {
    kind: 'while',
    branchHandle: conditionResult ? WHILE_LOOP_HANDLE : WHILE_DONE_HANDLE,
    iteration,
    conditionResult,
    matchedCondition: condition || undefined,
    passthrough: exprCtx.output,
  };
}
