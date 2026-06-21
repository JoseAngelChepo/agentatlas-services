export type RunSwarmToolInput = {
  swarmId: string;
  input?: Record<string, unknown>;
};

export type RunSwarmToolOutput = {
  swarmRunId: string;
  status: 'done' | 'failed' | 'paused';
  output: Record<string, unknown> | null;
  error: string | null;
};
