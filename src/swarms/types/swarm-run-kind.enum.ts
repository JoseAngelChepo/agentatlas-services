/** How a {@link SwarmRun} was triggered (for UI filtering and analytics). */
export enum SwarmRunKind {
  /** Full graph traversal via {@link SwarmOrchestratorService.runSwarm}. */
  SWARM = 'swarm',
  /** Nested swarm invoked from a parent graph sub-swarm node. */
  SUB_SWARM = 'sub_swarm',
  /** Single-worker test from the workspace inspector panel. */
  WORKER_PREVIEW = 'worker_preview',
}
