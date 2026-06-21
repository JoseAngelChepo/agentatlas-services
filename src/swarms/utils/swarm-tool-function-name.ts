import { Types } from 'mongoose';

export const SWARM_TOOL_PREFIX = 'swarm_';

export function swarmToolFunctionName(swarmId: string): string {
  return `${SWARM_TOOL_PREFIX}${swarmId}`;
}

export function parseSwarmIdFromToolFunctionName(name: string): string | null {
  if (!name.startsWith(SWARM_TOOL_PREFIX)) {
    return null;
  }
  const swarmId = name.slice(SWARM_TOOL_PREFIX.length);
  return Types.ObjectId.isValid(swarmId) ? swarmId : null;
}
