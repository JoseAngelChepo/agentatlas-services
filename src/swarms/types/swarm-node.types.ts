/** Mirrors workspace sub-swarm node `data` shape. */
export type SwarmNodeInputFieldSource = 'field' | 'runInput' | 'shared' | 'static' | 'upstream';

export type SwarmNodeInputField = {
  id?: string;
  key?: string;
  source?: SwarmNodeInputFieldSource;
  valuePath?: string;
  staticValue?: string;
};

export type SwarmNodeData = {
  label?: string;
  swarmId?: string;
  inputFields?: SwarmNodeInputField[];
  passShared?: boolean;
};

export const SUB_SWARM_SUCCESS_HANDLE = 'success';
export const SUB_SWARM_FAILED_HANDLE = 'failed';

export type SwarmNodeOutput = {
  kind: 'swarm';
  swarmId: string;
  swarmRunId: string;
  branchHandle: typeof SUB_SWARM_SUCCESS_HANDLE | typeof SUB_SWARM_FAILED_HANDLE;
  status: 'done' | 'failed' | 'paused';
  output: Record<string, unknown> | null;
  error: string | null;
};
