import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { InferenceProviderKind } from '../types/inference-provider-kind.enum';
import type { ChatCompletionRequest, ChatCompletionResult } from '../types/chat-completion.types';
import type { ChatStreamCallbacks } from '../types/chat-stream.types';
import type { OpenAiWorkerToolsConfig } from '../types/openai-worker-tools.types';
import type { InferenceStreamOptions } from '../types/tool-call.types';
import { buildOpenAiResponsesRequestBody } from './build-openai-responses-request';
import { hasOpenAiWorkerTools } from '../utils/parse-openai-worker-tools';
import { runOpenAiResponsesToolLoop } from './openai-responses-tool-loop';

type OpenAiConnection = { apiKey: string; baseURL: string };

@Injectable()
export class OpenAiResponsesInferenceService {
  private readonly logger = new Logger(OpenAiResponsesInferenceService.name);

  isOfficialOpenAiEndpoint(baseURL: string): boolean {
    const normalized = baseURL.toLowerCase();
    return normalized.includes('api.openai.com');
  }

  async streamCompletion(
    request: ChatCompletionRequest,
    openaiTools: OpenAiWorkerToolsConfig,
    conn: OpenAiConnection,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
    options?: InferenceStreamOptions,
  ): Promise<ChatCompletionResult> {
    const requestBody = buildOpenAiResponsesRequestBody(request, openaiTools);
    const hasCustomFunctions = (openaiTools.functions?.length ?? 0) > 0;

    callbacks.onMeta?.({
      provider: InferenceProviderKind.OPENAI_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });

    if (hasCustomFunctions && options?.onToolCall) {
      return this.completionWithToolLoop(
        request,
        requestBody,
        openaiTools,
        conn,
        callbacks,
        logLabel,
        options.onToolCall,
      );
    }

    return this.streamCompletionOnce(request, requestBody, conn, callbacks, logLabel, openaiTools);
  }

  private async completionWithToolLoop(
    request: ChatCompletionRequest,
    requestBody: Record<string, unknown>,
    openaiTools: OpenAiWorkerToolsConfig,
    conn: OpenAiConnection,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
    onToolCall: NonNullable<InferenceStreamOptions['onToolCall']>,
  ): Promise<ChatCompletionResult> {
    const client = new OpenAI({
      apiKey: conn.apiKey,
      baseURL: conn.baseURL,
      timeout: request.timeoutMs,
    });

    this.logger.log(
      `[${logLabel}] POST /responses model=${request.model} tools=${JSON.stringify(requestBody.tools ?? [])} (tool loop)`,
    );

    const started = Date.now();

    try {
      const { response, toolCalls } = await runOpenAiResponsesToolLoop(
        client,
        requestBody,
        onToolCall,
        { onDelta: (delta) => callbacks.onDelta?.(delta) },
      );

      const assembled = response.output_text?.trim() ?? '';
      const usage = response.usage;

      return {
        text: assembled,
        finishReason: response.status ?? 'completed',
        usage: usage
          ? {
              promptTokens: usage.input_tokens,
              completionTokens: usage.output_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
        provider: InferenceProviderKind.OPENAI_DIRECT,
        baseURL: conn.baseURL,
        model: request.model,
        latencyMs: Date.now() - started,
        rawRequest: requestBody,
        rawResponse: {
          finishReason: response.status ?? 'completed',
          usage,
          toolCalls,
          webSearchCalls: openaiTools.webSearch ? 0 : undefined,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OpenAI Responses tool loop failed';
      this.logger.warn(`[${logLabel}] responses tool loop error: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  private async streamCompletionOnce(
    request: ChatCompletionRequest,
    requestBody: Record<string, unknown>,
    conn: OpenAiConnection,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
    openaiTools: OpenAiWorkerToolsConfig,
  ): Promise<ChatCompletionResult> {
    const client = new OpenAI({
      apiKey: conn.apiKey,
      baseURL: conn.baseURL,
      timeout: request.timeoutMs,
    });

    this.logger.log(
      `[${logLabel}] POST /responses model=${request.model} tools=${JSON.stringify(requestBody.tools ?? [])}`,
    );

    const started = Date.now();
    let assembled = '';
    let finishReason: string | undefined;
    let usage: ChatCompletionResult['usage'];
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
            event.response.error?.message ?? 'OpenAI Responses request failed';
          throw new Error(message);
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'OpenAI Responses stream failed';
      this.logger.warn(`[${logLabel}] responses error: ${message}`);
      throw new BadGatewayException(message);
    }

    return {
      text: assembled.trim(),
      finishReason,
      usage,
      provider: InferenceProviderKind.OPENAI_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: requestBody,
      rawResponse: {
        finishReason,
        usage,
        webSearchCalls: hasOpenAiWorkerTools(openaiTools) ? webSearchCalls : undefined,
      },
    };
  }
}
