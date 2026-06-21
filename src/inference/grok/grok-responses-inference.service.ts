import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { InferenceProviderKind } from '../types/inference-provider-kind.enum';
import type { ChatCompletionRequest, ChatCompletionResult } from '../types/chat-completion.types';
import type { ChatStreamCallbacks } from '../types/chat-stream.types';
import type { GrokWorkerToolsConfig } from '../types/grok-worker-tools.types';
import { buildGrokResponsesRequestBody } from './build-grok-responses-request';

type GrokConnection = { apiKey: string; baseURL: string };

@Injectable()
export class GrokResponsesInferenceService {
  private readonly logger = new Logger(GrokResponsesInferenceService.name);

  isXaiResponsesEndpoint(baseURL: string): boolean {
    const normalized = baseURL.toLowerCase();
    return normalized.includes('api.x.ai');
  }

  async streamCompletion(
    request: ChatCompletionRequest,
    grokTools: GrokWorkerToolsConfig,
    conn: GrokConnection,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const requestBody = buildGrokResponsesRequestBody(request, grokTools);

    callbacks.onMeta?.({
      provider: InferenceProviderKind.GROK_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });

    const client = new OpenAI({
      apiKey: conn.apiKey,
      baseURL: conn.baseURL,
      timeout: request.timeoutMs,
    });

    this.logger.log(
      `[${logLabel}] POST /responses (grok) model=${request.model} tools=${JSON.stringify(requestBody.tools ?? [])}`,
    );

    const started = Date.now();
    let assembled = '';
    let finishReason: string | undefined;
    let usage: ChatCompletionResult['usage'];
    let xSearchCalls = 0;
    let webSearchCalls = 0;

    try {
      const stream = await client.responses.create(
        requestBody as Parameters<OpenAI['responses']['create']>[0],
      );

      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        if (event.type === 'response.output_text.delta') {
          const delta = event.delta;
          if (delta) {
            assembled += delta;
            callbacks.onDelta?.(delta);
          }
        }

        if (event.type === 'response.web_search_call.searching') {
          webSearchCalls += 1;
        }

        if (String(event.type).includes('x_search')) {
          xSearchCalls += 1;
        }

        if (event.type === 'response.completed') {
          const response = event.response;
          if (response.output_text?.trim()) {
            assembled = response.output_text;
          }
          finishReason = response.status ?? 'completed';
          const u = response.usage;
          if (u) {
            usage = {
              promptTokens: u.input_tokens,
              completionTokens: u.output_tokens,
              totalTokens: u.total_tokens,
            };
          }
        }

        if (event.type === 'response.failed') {
          const message =
            event.response.error?.message ?? 'xAI Responses request failed';
          throw new Error(message);
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'xAI Responses stream failed';
      this.logger.warn(`[${logLabel}] grok responses error: ${message}`);
      throw new BadGatewayException(message);
    }

    return {
      text: assembled.trim(),
      finishReason,
      usage,
      provider: InferenceProviderKind.GROK_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: requestBody,
      rawResponse: {
        finishReason,
        usage,
        xSearchCalls: grokTools.xSearch ? xSearchCalls : undefined,
        webSearchCalls: grokTools.webSearch ? webSearchCalls : undefined,
      },
    };
  }
}
