import type { ChatCompletionRequest, ChatMessage } from '../types/chat-completion.types';
import type { OpenAiWorkerToolsConfig } from '../types/openai-worker-tools.types';
import {
  buildOpenAiJsonSchemaResponseFormat,
  prepareSchemaForOpenAiStrict,
  sanitizeOpenAiSchemaName,
} from '../utils/build-openai-json-schema-format';
import {
  buildOpenAiResponsesTools,
  resolveOpenAiToolChoice,
} from './build-openai-responses-tools';
import { openAiSupportsTemperature } from '../utils/open-ai-max-output';

export function splitMessagesForResponses(messages: ChatMessage[]): {
  instructions?: string;
  input: string;
} {
  const systemParts: string[] = [];
  const userParts: string[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
    } else {
      userParts.push(message.content);
    }
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    input: userParts.join('\n\n').trim() || ' ',
  };
}

export function buildOpenAiResponsesRequestBody(
  request: ChatCompletionRequest,
  openaiTools: OpenAiWorkerToolsConfig,
): Record<string, unknown> {
  const { instructions, input } = splitMessagesForResponses(request.messages);
  const tools = buildOpenAiResponsesTools(openaiTools);
  const toolChoice = resolveOpenAiToolChoice(openaiTools);

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
    if (openaiTools.webSearch) {
      body.include = ['web_search_call.action.sources'];
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
