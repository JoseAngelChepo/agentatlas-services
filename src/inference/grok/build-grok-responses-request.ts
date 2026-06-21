import type { ChatCompletionRequest } from '../types/chat-completion.types';
import type { GrokWorkerToolsConfig } from '../types/grok-worker-tools.types';
import {
  buildOpenAiJsonSchemaResponseFormat,
  prepareSchemaForOpenAiStrict,
  sanitizeOpenAiSchemaName,
} from '../utils/build-openai-json-schema-format';
import { openAiSupportsTemperature } from '../utils/open-ai-max-output';
import { splitMessagesForResponses } from '../openai/build-openai-responses-request';
import { buildGrokResponsesTools, resolveGrokToolChoice } from './build-grok-responses-tools';

export function buildGrokResponsesRequestBody(
  request: ChatCompletionRequest,
  grokTools: GrokWorkerToolsConfig,
): Record<string, unknown> {
  const { instructions, input } = splitMessagesForResponses(request.messages);
  const tools = buildGrokResponsesTools(grokTools);
  const toolChoice = resolveGrokToolChoice(grokTools);

  const body: Record<string, unknown> = {
    model: request.model,
    input,
    stream: true,
  };

  if (openAiSupportsTemperature(request.model)) {
    body.temperature = request.temperature;
  }

  if (instructions) {
    body.instructions = instructions;
  }

  if (typeof request.maxTokens === 'number') {
    body.max_output_tokens = request.maxTokens;
  }

  if (tools.length > 0) {
    body.tools = tools;
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  const structured = request.outputSchema
    ? buildOpenAiJsonSchemaResponseFormat(
        request.outputSchema,
        request.structuredOutputName,
      )
    : null;

  if (structured) {
    body.text = {
      format: {
        type: 'json_schema',
        name: sanitizeOpenAiSchemaName(request.structuredOutputName ?? 'worker_output'),
        strict: true,
        schema: prepareSchemaForOpenAiStrict(
          structured.json_schema.schema as Record<string, unknown>,
        ),
      },
    };
  } else if (request.jsonMode) {
    body.text = { format: { type: 'json_object' } };
  }

  return body;
}
