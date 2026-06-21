import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { AgentTool } from '../types/agent-tool.interface';

export function agentToolToOpenAiFunction(tool: AgentTool): OpenAiFunctionToolDefinition {
  return {
    name: tool.id,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true,
  };
}
