/**
 * Minimal JSON Schema shape for OpenAI function `parameters`.
 * Keep schemas strict (`additionalProperties: false`) when possible.
 */
export type ToolInputSchema = {
  type: 'object';
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
  additionalProperties?: boolean;
};
