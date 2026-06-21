import { Injectable } from '@nestjs/common';
import { InferenceProviderKind } from '../types/inference-provider-kind.enum';
import {
  buildOpenAiJsonSchemaResponseFormat,
  hasStructuredOutputSchema,
  type OpenAiJsonSchemaResponseFormat,
} from '../utils/build-openai-json-schema-format';

/**
 * OpenAI-only structured outputs (JSON Schema via API, not prompt duplication).
 *
 * Uses Chat Completions `response_format.json_schema` today. A future path can add
 * Responses API + Zod (`responses.parse` + `zodTextFormat`) for workers that ship Zod defs.
 */
@Injectable()
export class OpenAiStructuredOutputService {
  /** Only official OpenAI direct API is enabled for strict json_schema in v1. */
  supportsStructuredOutput(
    provider: InferenceProviderKind,
    outputSchema?: Record<string, unknown>,
  ): boolean {
    return (
      provider === InferenceProviderKind.OPENAI_DIRECT &&
      hasStructuredOutputSchema(outputSchema)
    );
  }

  buildResponseFormat(
    outputSchema: Record<string, unknown>,
    schemaName = 'worker_output',
  ): OpenAiJsonSchemaResponseFormat | null {
    return buildOpenAiJsonSchemaResponseFormat(outputSchema, schemaName);
  }
}
