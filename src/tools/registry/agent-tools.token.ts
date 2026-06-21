import type { ExistingProvider, Provider, Type } from '@nestjs/common';
import type { AgentTool } from '../types/agent-tool.interface';

export const AGENT_TOOLS = Symbol('AGENT_TOOLS');

/**
 * Register an `AgentTool` class and expose it on the multi-provider token.
 * Returns two providers: the tool itself + `useExisting` for the registry.
 */
export function registerAgentTool(toolClass: Type<AgentTool>): Provider[] {
  const registryBinding: ExistingProvider & { multi: true } = {
    provide: AGENT_TOOLS,
    useExisting: toolClass,
    multi: true,
  };

  return [toolClass, registryBinding];
}
