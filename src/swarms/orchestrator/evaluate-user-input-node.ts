import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { UserInputNodeOutput } from '../types/user-input-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import type { GraphIndex } from '../utils/graph-index';

export function resolveUserInputPassthrough(
  graph: SwarmGraph,
  index: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): Record<string, unknown> {
  const exprCtx = buildSwarmExpressionContext(graph, index, context, nodeId, workers);
  return exprCtx.output ?? {};
}

export function buildUserInputNodeOutput(params: {
  needsInputId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  passthrough: Record<string, unknown>;
}): UserInputNodeOutput {
  return {
    kind: 'user_input',
    needsInputId: params.needsInputId,
    question: params.question,
    answer: params.answer,
    skipped: params.skipped,
    passthrough: params.passthrough,
  };
}
