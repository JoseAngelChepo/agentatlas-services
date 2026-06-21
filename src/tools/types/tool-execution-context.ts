export type ToolExecutionContext = {
  userId: string;
  swarmRunId?: string;
  agentRunId?: string;
  /** Swarm ids allowed on the worker (`swarmTools`). Empty means no whitelist. */
  allowedSwarmToolIds?: string[];
};
