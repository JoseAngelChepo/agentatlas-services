/** Mirrors workspace User approval node `data` shape. */
export type UserApprovalAssignee = 'runner' | 'owner' | string;

export type UserApprovalNodeData = {
  /** Canvas label; falls back to "User approval". */
  name?: string;
  /** Shown in the approval inbox / UI. */
  message?: string;
  /**
   * Who may approve: `runner` (triggeredBy), `owner` (swarm creator), or a user Mongo id.
   * Defaults to `runner`.
   */
  assignee?: UserApprovalAssignee;
};

export const USER_APPROVAL_APPROVE_HANDLE = 'approve';
export const USER_APPROVAL_REJECT_HANDLE = 'reject';

export type UserApprovalDecision = 'approve' | 'reject';

export type UserApprovalNodeOutput = {
  kind: 'user_approval';
  branchHandle: typeof USER_APPROVAL_APPROVE_HANDLE | typeof USER_APPROVAL_REJECT_HANDLE;
  decision: UserApprovalDecision;
  approvalId: string;
  name: string;
  message: string;
  comment?: string;
  /** Worker output from the node immediately before this gate (for downstream agents). */
  passthrough: Record<string, unknown>;
};
