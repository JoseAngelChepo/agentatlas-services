import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { InferenceProviderKind } from './types/inference-provider-kind.enum';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
} from './types/chat-completion.types';
import type { ChatStreamCallbacks } from './types/chat-stream.types';
import type { InferenceStreamOptions } from './types/tool-call.types';
import { openAiChatMaxOutputParam, openAiSupportsTemperature } from './utils/open-ai-max-output';
import { GrokResponsesInferenceService } from './grok/grok-responses-inference.service';
import { GeminiInferenceService } from './gemini/gemini-inference.service';
import { OpenAiResponsesInferenceService } from './openai/openai-responses-inference.service';
import { hasGrokWorkerTools, parseGrokWorkerTools } from './utils/parse-grok-worker-tools';
import { OpenAiStructuredOutputService } from './openai/openai-structured-output.service';
import type { OpenAiJsonSchemaResponseFormat } from './utils/build-openai-json-schema-format';
import { parseOpenAiWorkerTools } from './utils/parse-openai-worker-tools';

export type InferenceProviderSetup = {
  id: InferenceProviderKind;
  label: string;
  configured: boolean;
  envKeys: string[];
  defaultBaseUrl: string;
};

@Injectable()
export class InferenceProviderService {
  private readonly logger = new Logger(InferenceProviderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly openAiStructuredOutput: OpenAiStructuredOutputService,
    private readonly openAiResponses: OpenAiResponsesInferenceService,
    private readonly grokResponses: GrokResponsesInferenceService,
    private readonly gemini: GeminiInferenceService,
  ) {}

  defaultModel(): string {
    return this.config.get<string>('INFERENCE_DEFAULT_MODEL', 'gpt-4o-mini').trim();
  }

  defaultProviderKind(): InferenceProviderKind {
    const raw = this.config.get<string>('INFERENCE_DEFAULT_PROVIDER', 'openai_direct').trim();
    if ((Object.values(InferenceProviderKind) as string[]).includes(raw)) {
      return raw as InferenceProviderKind;
    }
    return InferenceProviderKind.OPENAI_DIRECT;
  }

  defaultTemperature(): number {
    const raw = Number(this.config.get<string>('INFERENCE_DEFAULT_TEMPERATURE', '0.35'));
    const n = Number.isFinite(raw) ? raw : 0.35;
    return Math.min(2, Math.max(0, n));
  }

  defaultMaxTokens(): number | undefined {
    const raw = this.config.get<string>('INFERENCE_DEFAULT_MAX_TOKENS', '').trim();
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(32_000, Math.max(1, Math.floor(n)));
  }

  defaultTimeoutMs(): number {
    const raw = Number(this.config.get<string>('INFERENCE_TIMEOUT_MS', '120000'));
    return Math.min(Math.max(Number.isFinite(raw) ? raw : 120_000, 5_000), 600_000);
  }

  anthropicDefaultMaxTokens(): number {
    const raw = Number(this.config.get<string>('ANTHROPIC_MAX_TOKENS_DEFAULT', '4096'));
    const n = Number.isFinite(raw) ? Math.floor(raw) : 4096;
    return Math.min(Math.max(n, 1), 32_000);
  }

  listProviderSetup(): InferenceProviderSetup[] {
    return [
      {
        id: InferenceProviderKind.OPENAI_DIRECT,
        label: 'OpenAI',
        configured: this.isProviderConfigured(InferenceProviderKind.OPENAI_DIRECT),
        envKeys: ['OPENAI_API_KEY', 'INFERENCE_API_KEY'],
        defaultBaseUrl: 'https://api.openai.com/v1',
      },
      {
        id: InferenceProviderKind.CLAUDE_DIRECT,
        label: 'Anthropic Claude',
        configured: this.isProviderConfigured(InferenceProviderKind.CLAUDE_DIRECT),
        envKeys: ['ANTHROPIC_API_KEY'],
        defaultBaseUrl: 'https://api.anthropic.com/v1',
      },
      {
        id: InferenceProviderKind.OPENROUTER,
        label: 'OpenRouter',
        configured: this.isProviderConfigured(InferenceProviderKind.OPENROUTER),
        envKeys: ['OPENROUTER_API_KEY'],
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
      },
      {
        id: InferenceProviderKind.HUGGING_FACE,
        label: 'Hugging Face',
        configured: this.isProviderConfigured(InferenceProviderKind.HUGGING_FACE),
        envKeys: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
        defaultBaseUrl: 'https://router.huggingface.co/v1',
      },
      {
        id: InferenceProviderKind.INFERENCE_NET,
        label: 'Inference.net',
        configured: this.isProviderConfigured(InferenceProviderKind.INFERENCE_NET),
        envKeys: ['INFERENCE_NET_API_KEY', 'INFERENCE_NET_BASE_URL'],
        defaultBaseUrl: '',
      },
      {
        id: InferenceProviderKind.OLLAMA,
        label: 'Ollama (local)',
        configured: this.isProviderConfigured(InferenceProviderKind.OLLAMA),
        envKeys: ['OLLAMA_INFERENCE_BASE_URL'],
        defaultBaseUrl: 'http://localhost:11434/v1',
      },
      {
        id: InferenceProviderKind.GROK_DIRECT,
        label: 'xAI Grok',
        configured: this.isProviderConfigured(InferenceProviderKind.GROK_DIRECT),
        envKeys: ['XAI_API_KEY', 'GROK_API_KEY'],
        defaultBaseUrl: 'https://api.x.ai/v1',
      },
      {
        id: InferenceProviderKind.GEMINI_DIRECT,
        label: 'Google Gemini',
        configured: this.isProviderConfigured(InferenceProviderKind.GEMINI_DIRECT),
        envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      },
    ];
  }

  isProviderConfigured(kind: InferenceProviderKind): boolean {
    try {
      if (kind === InferenceProviderKind.CLAUDE_DIRECT) {
        return Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim());
      }
      if (kind === InferenceProviderKind.GEMINI_DIRECT) {
        return this.gemini.isConfigured();
      }
      if (kind === InferenceProviderKind.OLLAMA) {
        return Boolean(this.config.get<string>('OLLAMA_INFERENCE_BASE_URL')?.trim());
      }
      if (kind === InferenceProviderKind.INFERENCE_NET) {
        return Boolean(
          this.config.get<string>('INFERENCE_NET_BASE_URL')?.trim() &&
            this.config.get<string>('INFERENCE_NET_API_KEY')?.trim(),
        );
      }
      this.resolveOpenAiCompatibleConnection(kind);
      return true;
    } catch {
      return false;
    }
  }

  async completeChat(request: ChatCompletionRequest, logLabel = 'inference'): Promise<ChatCompletionResult> {
    if (!request.messages.length) {
      throw new BadGatewayException('messages must not be empty');
    }

    if (request.provider === InferenceProviderKind.CLAUDE_DIRECT) {
      return this.completeAnthropic(request, logLabel);
    }

    if (request.provider === InferenceProviderKind.GEMINI_DIRECT) {
      return this.gemini.completeChat(request, logLabel);
    }

    const grokRouted = await this.tryGrokResponsesCompletion(request, {}, logLabel);
    if (grokRouted) {
      return grokRouted;
    }

    const responsesRouted = await this.tryOpenAiResponsesCompletion(request, {}, logLabel);
    if (responsesRouted) {
      return responsesRouted;
    }

    return this.completeOpenAiCompatible(request, logLabel);
  }

  /**
   * Streaming chat completion; invokes `onMeta` / `onDelta` while assembling the full text.
   */
  async streamChatCompletion(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel = 'inference-stream',
    options?: InferenceStreamOptions,
  ): Promise<ChatCompletionResult> {
    if (!request.messages.length) {
      throw new BadGatewayException('messages must not be empty');
    }

    if (request.provider === InferenceProviderKind.CLAUDE_DIRECT) {
      return this.streamAnthropic(request, callbacks, logLabel);
    }

    if (request.provider === InferenceProviderKind.GEMINI_DIRECT) {
      return this.gemini.streamChat(request, callbacks, logLabel);
    }

    const grokRouted = await this.tryGrokResponsesCompletion(
      request,
      callbacks,
      logLabel,
    );
    if (grokRouted) {
      return grokRouted;
    }

    const responsesRouted = await this.tryOpenAiResponsesCompletion(
      request,
      callbacks,
      logLabel,
      options,
    );
    if (responsesRouted) {
      return responsesRouted;
    }

    return this.streamOpenAiCompatible(request, callbacks, logLabel);
  }

  /**
   * Grok with `grokTools` uses xAI Responses API (`POST /v1/responses`) for hosted tools
   * (`x_search`, `web_search`). Workers without grok tools keep Chat Completions.
   */
  private async tryGrokResponsesCompletion(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
  ): Promise<ChatCompletionResult | null> {
    if (request.provider !== InferenceProviderKind.GROK_DIRECT) {
      return null;
    }

    const grokTools = parseGrokWorkerTools(request.grokTools ?? {});
    if (!hasGrokWorkerTools(grokTools)) {
      return null;
    }

    const conn = this.resolveOpenAiCompatibleConnection(request.provider);
    if (!this.grokResponses.isXaiResponsesEndpoint(conn.baseURL)) {
      this.logger.debug(
        `[${logLabel}] Grok tools require api.x.ai Responses API (current baseURL=${conn.baseURL}).`,
      );
      return null;
    }

    return this.grokResponses.streamCompletion(
      request,
      grokTools,
      conn,
      callbacks,
      logLabel,
    );
  }

  /**
   * OpenAI direct on api.openai.com always uses the Responses API (`POST /v1/responses`),
   * not Chat Completions. Custom `INFERENCE_BASE_URL` proxies fall back to completions.
   */
  private async tryOpenAiResponsesCompletion(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
    options?: InferenceStreamOptions,
  ): Promise<ChatCompletionResult | null> {
    if (request.provider !== InferenceProviderKind.OPENAI_DIRECT) {
      return null;
    }

    const conn = this.resolveOpenAiCompatibleConnection(request.provider);
    if (!this.openAiResponses.isOfficialOpenAiEndpoint(conn.baseURL)) {
      this.logger.debug(
        `[${logLabel}] Using Chat Completions — Responses API requires api.openai.com (current baseURL=${conn.baseURL}).`,
      );
      return null;
    }

    const openaiTools = parseOpenAiWorkerTools(request.openaiTools ?? {});

    return this.openAiResponses.streamCompletion(
      request,
      openaiTools,
      conn,
      callbacks,
      logLabel,
      options,
    );
  }

  private normalizeBaseUrl(raw: string): string {
    const t = raw.trim();
    if (!t) return '';
    return t.endsWith('/') ? t.slice(0, -1) : t;
  }

  private resolveOpenAiCompatibleConnection(kind: InferenceProviderKind): {
    apiKey: string;
    baseURL: string;
  } {
    switch (kind) {
      case InferenceProviderKind.OPENAI_DIRECT: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('INFERENCE_BASE_URL', 'https://api.openai.com/v1'),
        );
        const apiKey =
          this.config.get<string>('INFERENCE_API_KEY')?.trim() ||
          this.config.get<string>('OPENAI_API_KEY')?.trim() ||
          '';
        if (!apiKey) {
          throw new ServiceUnavailableException(
            'OPENAI_API_KEY or INFERENCE_API_KEY is not configured for openai_direct.',
          );
        }
        return { baseURL, apiKey };
      }
      case InferenceProviderKind.OPENROUTER: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('OPENROUTER_INFERENCE_BASE_URL', 'https://openrouter.ai/api/v1'),
        );
        const apiKey = this.config.get<string>('OPENROUTER_API_KEY')?.trim() || '';
        if (!apiKey) {
          throw new ServiceUnavailableException('OPENROUTER_API_KEY is not configured.');
        }
        return { baseURL, apiKey };
      }
      case InferenceProviderKind.HUGGING_FACE: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('HF_INFERENCE_BASE_URL', 'https://router.huggingface.co/v1'),
        );
        const apiKey =
          this.config.get<string>('HF_TOKEN')?.trim() ||
          this.config.get<string>('HUGGINGFACE_API_KEY')?.trim() ||
          '';
        if (!apiKey) {
          throw new ServiceUnavailableException('HF_TOKEN is not configured for hugging_face.');
        }
        return { baseURL, apiKey };
      }
      case InferenceProviderKind.INFERENCE_NET: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('INFERENCE_NET_BASE_URL', '').trim(),
        );
        const apiKey = this.config.get<string>('INFERENCE_NET_API_KEY')?.trim() || '';
        if (!baseURL || !apiKey) {
          throw new ServiceUnavailableException(
            'INFERENCE_NET_BASE_URL and INFERENCE_NET_API_KEY must be set.',
          );
        }
        return { baseURL, apiKey };
      }
      case InferenceProviderKind.OLLAMA: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('OLLAMA_INFERENCE_BASE_URL', 'http://localhost:11434/v1'),
        );
        const apiKey = this.config.get<string>('OLLAMA_API_KEY')?.trim() || 'ollama';
        return { baseURL, apiKey };
      }
      case InferenceProviderKind.GROK_DIRECT: {
        const baseURL = this.normalizeBaseUrl(
          this.config.get<string>('GROK_INFERENCE_BASE_URL', 'https://api.x.ai/v1'),
        );
        const apiKey =
          this.config.get<string>('XAI_API_KEY')?.trim() ||
          this.config.get<string>('GROK_API_KEY')?.trim() ||
          '';
        if (!apiKey) {
          throw new ServiceUnavailableException(
            'XAI_API_KEY or GROK_API_KEY is not configured for grok_direct.',
          );
        }
        return { baseURL, apiKey };
      }
      default:
        throw new ServiceUnavailableException(
          `Provider "${kind}" is not OpenAI-compatible.`,
        );
    }
  }

  private toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private resolveOpenAiResponseFormat(
    request: ChatCompletionRequest,
  ): OpenAiJsonSchemaResponseFormat | { type: 'json_object' } | undefined {
    if (
      this.openAiStructuredOutput.supportsStructuredOutput(
        request.provider,
        request.outputSchema,
      ) &&
      request.outputSchema
    ) {
      const structured = this.openAiStructuredOutput.buildResponseFormat(
        request.outputSchema,
        request.structuredOutputName,
      );
      if (structured) {
        return structured;
      }
    }

    if (request.jsonMode) {
      return { type: 'json_object' };
    }

    return undefined;
  }

  private async completeOpenAiCompatible(
    request: ChatCompletionRequest,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const conn = this.resolveOpenAiCompatibleConnection(request.provider);
    const client = new OpenAI({
      apiKey: conn.apiKey,
      baseURL: conn.baseURL,
      timeout: request.timeoutMs,
    });

    const maxOut =
      typeof request.maxTokens === 'number'
        ? openAiChatMaxOutputParam(request.model, request.maxTokens)
        : null;

    const started = Date.now();
    this.logger.log(
      `[${logLabel}] ${request.provider} model=${request.model} baseURL=${conn.baseURL}`,
    );
    const responseFormat = this.resolveOpenAiResponseFormat(request);
    const requestBody: ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages: this.toOpenAiMessages(request.messages),
      ...(openAiSupportsTemperature(request.model)
        ? { temperature: request.temperature }
        : {}),
      ...(maxOut ?? {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    try {
      const completion = await client.chat.completions.create(requestBody);

      const text = completion.choices[0]?.message?.content?.trim() ?? '';
      const usage = completion.usage;

      return {
        text,
        finishReason: completion.choices[0]?.finish_reason ?? undefined,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
        provider: request.provider,
        baseURL: conn.baseURL,
        model: request.model,
        latencyMs: Date.now() - started,
        rawRequest: requestBody as unknown as Record<string, unknown>,
        rawResponse: completion as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Inference request failed';
      this.logger.warn(`[${logLabel}] ${request.provider} error: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  private buildAnthropicBody(
    messages: ChatMessage[],
    model: string,
    maxTokens: number | undefined,
    temperature: number,
  ): Record<string, unknown> {
    const systemParts: string[] = [];
    const turns: { role: 'user' | 'assistant'; content: string }[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === 'user' || m.role === 'assistant') {
        turns.push({ role: m.role, content: m.content });
      }
    }

    const effectiveMaxTokens =
      typeof maxTokens === 'number' && Number.isFinite(maxTokens)
        ? Math.max(1, Math.floor(maxTokens))
        : this.anthropicDefaultMaxTokens();

    const body: Record<string, unknown> = {
      model,
      max_tokens: effectiveMaxTokens,
      messages: turns,
      temperature,
    };

    if (systemParts.length) {
      body['system'] = systemParts.join('\n\n');
    }

    return body;
  }

  private async completeAnthropic(
    request: ChatCompletionRequest,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured.');
    }

    const baseURL = 'https://api.anthropic.com/v1';
    const body = this.buildAnthropicBody(
      request.messages,
      request.model,
      request.maxTokens,
      request.temperature,
    );

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch(`${baseURL}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText.slice(0, 800) || `Anthropic HTTP ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const content = data['content'] as { type?: string; text?: string }[] | undefined;
      const text =
        content
          ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('') ?? '';

      const usageRaw = data['usage'] as Record<string, unknown> | undefined;

      return {
        text: text.trim(),
        finishReason:
          typeof data['stop_reason'] === 'string' ? (data['stop_reason'] as string) : undefined,
        usage: usageRaw
          ? {
              promptTokens:
                typeof usageRaw['input_tokens'] === 'number'
                  ? usageRaw['input_tokens']
                  : undefined,
              completionTokens:
                typeof usageRaw['output_tokens'] === 'number'
                  ? usageRaw['output_tokens']
                  : undefined,
            }
          : undefined,
        provider: InferenceProviderKind.CLAUDE_DIRECT,
        baseURL,
        model: request.model,
        latencyMs: Date.now() - started,
        rawRequest: body,
        rawResponse: data,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Anthropic request timed out'
            : err.message
          : 'Anthropic request failed';
      this.logger.warn(`[${logLabel}] anthropic error: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  private async streamOpenAiCompatible(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const conn = this.resolveOpenAiCompatibleConnection(request.provider);
    const client = new OpenAI({
      apiKey: conn.apiKey,
      baseURL: conn.baseURL,
      timeout: request.timeoutMs,
    });

    const maxOut =
      typeof request.maxTokens === 'number'
        ? openAiChatMaxOutputParam(request.model, request.maxTokens)
        : null;

    callbacks.onMeta?.({
      provider: request.provider,
      baseURL: conn.baseURL,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });

    const started = Date.now();
    let assembled = '';
    let finishReason: string | undefined;
    let usage: ChatCompletionResult['usage'];
    const responseFormat = this.resolveOpenAiResponseFormat(request);
    const requestBody: ChatCompletionCreateParamsStreaming = {
      model: request.model,
      stream: true,
      messages: this.toOpenAiMessages(request.messages),
      ...(openAiSupportsTemperature(request.model)
        ? { temperature: request.temperature }
        : {}),
      ...(maxOut ?? {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(request.provider !== InferenceProviderKind.OLLAMA
        ? { stream_options: { include_usage: true } as const }
        : {}),
    };

    try {
      const stream = await client.chat.completions.create(requestBody);

      for await (const chunk of stream) {
        const u = chunk.usage;
        if (u) {
          usage = {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          };
        }
        const choice = chunk.choices[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta?.content;
        if (delta) {
          assembled += delta;
          callbacks.onDelta?.(delta);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Inference stream failed';
      this.logger.warn(`[${logLabel}] ${request.provider} stream error: ${message}`);
      throw new BadGatewayException(message);
    }

    return {
      text: assembled.trim(),
      finishReason,
      usage,
      provider: request.provider,
      baseURL: conn.baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: requestBody as unknown as Record<string, unknown>,
      rawResponse: {
        finishReason,
        usage,
      },
    };
  }

  private async streamAnthropic(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured.');
    }

    const baseURL = 'https://api.anthropic.com/v1';
    const body = {
      ...this.buildAnthropicBody(
        request.messages,
        request.model,
        request.maxTokens,
        request.temperature,
      ),
      stream: true,
    };

    callbacks.onMeta?.({
      provider: InferenceProviderKind.CLAUDE_DIRECT,
      baseURL,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let assembled = '';
    let finishReason: string | undefined;
    let usage: ChatCompletionResult['usage'];

    try {
      const response = await fetch(`${baseURL}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText.slice(0, 800) || `Anthropic HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Empty Anthropic response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';

      const handleEvent = (eventType: string, dataLine: string) => {
        if (!dataLine.trim()) return;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(dataLine) as Record<string, unknown>;
        } catch {
          return;
        }
        if (eventType === 'content_block_delta') {
          const delta = obj['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            const text = delta['text'];
            assembled += text;
            callbacks.onDelta?.(text);
          }
        }
        if (eventType === 'message_delta') {
          const d = obj['delta'] as Record<string, unknown> | undefined;
          if (typeof d?.['stop_reason'] === 'string') {
            finishReason = d['stop_reason'];
          }
          const u = obj['usage'] as Record<string, unknown> | undefined;
          if (u) {
            usage = {
              promptTokens:
                typeof u['input_tokens'] === 'number' ? u['input_tokens'] : undefined,
              completionTokens:
                typeof u['output_tokens'] === 'number' ? u['output_tokens'] : undefined,
            };
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const blocks = carry.split('\n\n');
        carry = blocks.pop() ?? '';
        for (const block of blocks) {
          let eventType = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              handleEvent(eventType, line.slice(5).trimStart());
            }
          }
        }
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Anthropic stream timed out'
            : err.message
          : 'Anthropic stream failed';
      this.logger.warn(`[${logLabel}] anthropic stream error: ${message}`);
      throw new BadGatewayException(message);
    }

    return {
      text: assembled.trim(),
      finishReason,
      usage,
      provider: InferenceProviderKind.CLAUDE_DIRECT,
      baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: body as Record<string, unknown>,
      rawResponse: {
        finishReason,
        usage,
      },
    };
  }
}
