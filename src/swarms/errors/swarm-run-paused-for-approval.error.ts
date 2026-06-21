import type { SerializedSwarmRunApproval } from '../utils/swarm-run-approval-serializers';

/** Thrown when traversal stops at a user-approval node (not a failure). */
export class SwarmRunPausedForApprovalError extends Error {
  readonly approval: SerializedSwarmRunApproval;

  constructor(approval: SerializedSwarmRunApproval) {
    super('Swarm run paused for user approval');
    this.name = 'SwarmRunPausedForApprovalError';
    this.approval = approval;
  }
}
