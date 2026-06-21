import type { OpenAiWorkerToolsConfig } from '../../inference/types/openai-worker-tools.types';
import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';

export function mergeAgentToolsIntoOpenAiConfig(
  openaiTools: OpenAiWorkerToolsConfig,
  agentToolFunctions: OpenAiFunctionToolDefinition[],
): OpenAiWorkerToolsConfig {
  if (agentToolFunctions.length === 0) {
    return openaiTools;
  }

  const existingNames = new Set((openaiTools.functions ?? []).map((fn) => fn.name));
  const merged = [...(openaiTools.functions ?? [])];

  for (const fn of agentToolFunctions) {
    if (!existingNames.has(fn.name)) {
      merged.push(fn);
      existingNames.add(fn.name);
    }
  }

  return {
    ...openaiTools,
    functions: merged,
  };
}
