export enum RunStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  /** Paused at a user-approval node; resume via `POST /swarm-run-approvals/:id/decide`. */
  AWAITING_APPROVAL = 'awaiting_approval',
  /** Paused at a user-input node; resume via `POST /needs-input/:id/answer`. */
  AWAITING_INPUT = 'awaiting_input',
  FAILED = 'failed',
  DONE = 'done',
}
