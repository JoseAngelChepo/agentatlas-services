import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import { prepareSchemaForOpenAiStrict } from '../../inference/utils/build-openai-json-schema-format';
import type { AgentTool } from '../types/agent-tool.interface';
import type { ToolInputSchema } from '../types/tool-input-schema.types';

/**
 * OpenAI strict function schemas require `required` to list every key in `properties`.
 * Tools with optional args use non-strict schemas instead.
 */
function isStrictCompatibleToolSchema(schema: ToolInputSchema): boolean {
  const properties = schema.properties ?? {};
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    return false;
  }

  const required = new Set(schema.required ?? []);
  return keys.every((key) => required.has(key));
}

export function agentToolToOpenAiFunction(tool: AgentTool): OpenAiFunctionToolDefinition {
  const strict = isStrictCompatibleToolSchema(tool.inputSchema);
  const parameters = strict
    ? prepareSchemaForOpenAiStrict(structuredClone(tool.inputSchema) as Record<string, unknown>)
    : {
        ...tool.inputSchema,
        additionalProperties: tool.inputSchema.additionalProperties ?? false,
      };

  return {
    name: tool.id,
    description: tool.description,
    parameters,
    ...(strict ? { strict: true } : {}),
  };
}
