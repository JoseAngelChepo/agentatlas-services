import type { ToolExecutionContext } from '../../tools/types/tool-execution-context';

export type SwarmToolExecutionContext = ToolExecutionContext & {
  /** Swarm ids allowed on the worker (`swarmTools`). Empty means no whitelist. */
  allowedSwarmToolIds?: string[];
};

export const SWARM_TOOL_INPUT_SCHEMA = {
  type: 'object',
  description: 'Fields passed as the child swarm run input object',
  additionalProperties: true,
} as const;
