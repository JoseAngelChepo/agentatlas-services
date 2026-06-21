import { ToolId } from '../types/tool-id.enum';

export function splitRegistryAgentToolIds(toolIds: ToolId[]): {
  registryToolIds: ToolId[];
  includesRunSwarm: boolean;
} {
  return {
    registryToolIds: toolIds.filter((id) => id !== ToolId.RUN_SWARM),
    includesRunSwarm: toolIds.includes(ToolId.RUN_SWARM),
  };
}

/**
 * `run_swarm` is redundant when the worker lists specific swarms in `swarmTools`
 * (each gets a dedicated `swarm_<objectId>` function with a clearer description).
 */
export function shouldExposeRunSwarmTool(
  includesRunSwarm: boolean,
  swarmToolIds: string[],
): boolean {
  if (!includesRunSwarm) {
    return false;
  }

  return swarmToolIds.length === 0;
}
