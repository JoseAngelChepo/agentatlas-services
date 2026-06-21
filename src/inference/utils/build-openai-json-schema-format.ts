/**
 * Prepares worker `outputSchema` (JSON Schema) for OpenAI Chat Completions
 * `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`.
 *
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */

export type OpenAiJsonSchemaResponseFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

const SCHEMA_NAME_MAX = 64;
const SCHEMA_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

export function hasStructuredOutputSchema(
  schema: Record<string, unknown> | undefined,
): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const props = schema.properties;
  if (props && typeof props === 'object' && Object.keys(props).length > 0) {
    return true;
  }
  return false;
}

export function sanitizeOpenAiSchemaName(raw: string): string {
  const cleaned = raw.trim().replace(SCHEMA_NAME_PATTERN, '_').replace(/_+/g, '_');
  const name = cleaned.length > 0 ? cleaned : 'worker_output';
  return name.slice(0, SCHEMA_NAME_MAX);
}

/**
 * Normalizes a JSON Schema object for OpenAI strict structured outputs.
 */
export function prepareSchemaForOpenAiStrict(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const clone = structuredClone(schema) as Record<string, unknown>;
  normalizeObjectSchemaNode(clone);
  return clone;
}

function normalizeObjectSchemaNode(node: Record<string, unknown>): void {
  if (node.type === 'array') {
    const items = node.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      normalizeObjectSchemaNode(items as Record<string, unknown>);
    }
    return;
  }

  const props = node.properties;
  const hasProps = props && typeof props === 'object' && Object.keys(props).length > 0;

  if (hasProps || node.type === 'object') {
    node.type = 'object';
    node.additionalProperties = false;

    if (hasProps) {
      const propKeys = Object.keys(props as Record<string, unknown>);
      if (!Array.isArray(node.required) || (node.required as unknown[]).length === 0) {
        node.required = propKeys;
      }

      for (const key of propKeys) {
        const child = (props as Record<string, unknown>)[key];
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          normalizeObjectSchemaNode(child as Record<string, unknown>);
        }
      }
    }
  }
}

export function buildOpenAiJsonSchemaResponseFormat(
  outputSchema: Record<string, unknown>,
  schemaName = 'worker_output',
): OpenAiJsonSchemaResponseFormat | null {
  if (!hasStructuredOutputSchema(outputSchema)) {
    return null;
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: sanitizeOpenAiSchemaName(schemaName),
      strict: true,
      schema: prepareSchemaForOpenAiStrict(outputSchema),
    },
  };
}
