import OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import type { ToolCallHandler } from '../types/tool-call.types';

const DEFAULT_MAX_ROUNDS = 8;

export async function runOpenAiResponsesToolLoop(
  client: OpenAI,
  baseBody: Record<string, unknown>,
  onToolCall: ToolCallHandler,
  options?: {
    maxRounds?: number;
    onDelta?: (delta: string) => void;
  },
): Promise<{ response: Response; toolCalls: number }> {
  const maxRounds = options?.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const initialInput = typeof baseBody.input === 'string' ? baseBody.input.trim() : '';
  const conversation: unknown[] = [
    {
      role: 'user',
      type: 'message',
      content: initialInput || ' ',
    },
  ];

  let toolCalls = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const body = {
      ...baseBody,
      input: conversation,
      stream: false as const,
    };

    const response = (await client.responses.create(
      body as Parameters<OpenAI['responses']['create']>[0],
    )) as Response;

    const output = response.output ?? [];
    const reasoning = output.filter((item) => item.type === 'reasoning');
    const functionCalls = output.filter((item) => item.type === 'function_call');

    if (reasoning.length > 0) {
      conversation.push(...reasoning);
    }

    if (functionCalls.length > 0) {
      for (const item of functionCalls) {
        if (item.type !== 'function_call') {
          continue;
        }

        conversation.push(item);
        toolCalls += 1;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(item.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }

        const result = await onToolCall(item.name, args);
        conversation.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: result,
        });
      }
      continue;
    }

    const text = response.output_text?.trim() ?? '';
    if (text && options?.onDelta) {
      options.onDelta(text);
    }

    return { response, toolCalls };
  }

  throw new Error(`OpenAI tool loop exceeded ${maxRounds} rounds`);
}
