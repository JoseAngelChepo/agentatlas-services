import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { UserApprovalNodeOutput } from '../types/user-approval-node.types';
import {
  USER_APPROVAL_APPROVE_HANDLE,
  USER_APPROVAL_REJECT_HANDLE,
  type UserApprovalDecision,
} from '../types/user-approval-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import type { GraphIndex } from '../utils/graph-index';

/** Passthrough payload from the predecessor worker (for inbox preview + downstream agents). */
export function resolveUserApprovalPassthrough(
  graph: SwarmGraph,
  index: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): Record<string, unknown> {
  const exprCtx = buildSwarmExpressionContext(graph, index, context, nodeId, workers);
  return exprCtx.output ?? {};
}

export function buildUserApprovalNodeOutput(params: {
  decision: UserApprovalDecision;
  approvalId: string;
  name: string;
  message: string;
  comment?: string;
  passthrough: Record<string, unknown>;
}): UserApprovalNodeOutput {
  const branchHandle =
    params.decision === 'approve' ? USER_APPROVAL_APPROVE_HANDLE : USER_APPROVAL_REJECT_HANDLE;
  return {
    kind: 'user_approval',
    branchHandle,
    decision: params.decision,
    approvalId: params.approvalId,
    name: params.name,
    message: params.message,
    ...(params.comment?.trim() ? { comment: params.comment.trim() } : {}),
    passthrough: params.passthrough,
  };
}
