import type { SwarmRunApprovalDocument } from '../schemas/swarm-run-approval.schema';

type WithTimestamps = { createdAt?: Date; updatedAt?: Date };

export type SerializedSwarmRunApproval = ReturnType<typeof serializeSwarmRunApproval>;

export function serializeSwarmRunApproval(doc: SwarmRunApprovalDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;
  return {
    id: doc.id,
    swarmRunId: doc.swarmRunId.toString(),
    swarmId: doc.swarmId.toString(),
    nodeId: doc.nodeId,
    name: doc.name,
    message: doc.message,
    passthrough: doc.passthrough ?? {},
    assigneeUserId: doc.assigneeUserId.toString(),
    requestedBy: doc.requestedBy.toString(),
    status: doc.status,
    decision: doc.decision,
    comment: doc.comment ?? '',
    decidedBy: doc.decidedBy?.toString() ?? null,
    decidedAt: doc.decidedAt ?? null,
    createdAt,
    updatedAt,
  };
}
