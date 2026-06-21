import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InferenceProviderKind } from '../types/inference-provider-kind.enum';
import type { ChatCompletionRequest, ChatCompletionResult } from '../types/chat-completion.types';
import type { ChatStreamCallbacks } from '../types/chat-stream.types';
import { buildGeminiGenerateRequest, geminiModelPath } from './build-gemini-request';

type GeminiConnection = { apiKey: string; baseURL: string };

type GeminiCandidate = {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

@Injectable()
export class GeminiInferenceService {
  private readonly logger = new Logger(GeminiInferenceService.name);

  constructor(private readonly config: ConfigService) {}

  resolveConnection(): GeminiConnection {
    const apiKey =
      this.config.get<string>('GEMINI_API_KEY')?.trim() ||
      this.config.get<string>('GOOGLE_API_KEY')?.trim() ||
      '';
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY or GOOGLE_API_KEY is not configured for gemini_direct.',
      );
    }

    const baseURL = this.normalizeBaseUrl(
      this.config.get<string>(
        'GEMINI_INFERENCE_BASE_URL',
        'https://generativelanguage.googleapis.com/v1beta',
      ),
    );

    return { apiKey, baseURL };
  }

  isConfigured(): boolean {
    try {
      this.resolveConnection();
      return true;
    } catch {
      return false;
    }
  }

  async completeChat(
    request: ChatCompletionRequest,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const conn = this.resolveConnection();
    const body = buildGeminiGenerateRequest(
      request.messages,
      request.temperature,
      request.maxTokens,
      request.jsonMode,
    );
    const modelPath = geminiModelPath(request.model);
    const url = `${conn.baseURL}/${modelPath}:generateContent`;

    const started = Date.now();
    this.logger.log(`[${logLabel}] gemini_direct model=${request.model} baseURL=${conn.baseURL}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': conn.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText.slice(0, 800) || `Gemini HTTP ${response.status}`);
      }

      const data = (await response.json()) as GeminiResponse;
      return this.toResult(data, request, conn, body, started);
    } catch (err: unknown) {
      clearTimeout(timer);
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Gemini request timed out'
            : err.message
          : 'Gemini request failed';
      this.logger.warn(`[${logLabel}] gemini_direct error: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  async streamChat(
    request: ChatCompletionRequest,
    callbacks: ChatStreamCallbacks,
    logLabel: string,
  ): Promise<ChatCompletionResult> {
    const conn = this.resolveConnection();
    const body = buildGeminiGenerateRequest(
      request.messages,
      request.temperature,
      request.maxTokens,
      request.jsonMode,
    );
    const modelPath = geminiModelPath(request.model);
    const url = `${conn.baseURL}/${modelPath}:streamGenerateContent?alt=sse`;

    callbacks.onMeta?.({
      provider: InferenceProviderKind.GEMINI_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      timeoutMs: request.timeoutMs,
    });

    const started = Date.now();
    this.logger.log(
      `[${logLabel}] gemini_direct stream model=${request.model} baseURL=${conn.baseURL}`,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let assembled = '';
    let finishReason: string | undefined;
    let usage: ChatCompletionResult['usage'];

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': conn.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(errText.slice(0, 800) || `Gemini HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Empty Gemini response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });

        const lines = carry.split('\n');
        carry = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trimStart();
          if (!payload || payload === '[DONE]') continue;

          let chunk: GeminiResponse;
          try {
            chunk = JSON.parse(payload) as GeminiResponse;
          } catch {
            continue;
          }

          const parsed = this.parseGeminiResponse(chunk);
          if (parsed.finishReason) {
            finishReason = parsed.finishReason;
          }
          if (parsed.usage) {
            usage = parsed.usage;
          }

          if (parsed.text) {
            assembled += parsed.text;
            callbacks.onDelta?.(parsed.text);
          }
        }
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Gemini stream timed out'
            : err.message
          : 'Gemini stream failed';
      this.logger.warn(`[${logLabel}] gemini_direct stream error: ${message}`);
      throw new BadGatewayException(message);
    }

    return {
      text: assembled.trim(),
      finishReason,
      usage,
      provider: InferenceProviderKind.GEMINI_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: body as unknown as Record<string, unknown>,
      rawResponse: {
        finishReason,
        usage,
      },
    };
  }

  private normalizeBaseUrl(raw: string): string {
    const t = raw.trim();
    if (!t) return '';
    return t.endsWith('/') ? t.slice(0, -1) : t;
  }

  private parseGeminiResponse(data: GeminiResponse): {
    text: string;
    finishReason?: string;
    usage?: ChatCompletionResult['usage'];
  } {
    const candidate = data.candidates?.[0];
    const text =
      candidate?.content?.parts
        ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('') ?? '';

    const usageRaw = data.usageMetadata;
    const usage = usageRaw
      ? {
          promptTokens: usageRaw.promptTokenCount,
          completionTokens: usageRaw.candidatesTokenCount,
          totalTokens: usageRaw.totalTokenCount,
        }
      : undefined;

    return {
      text,
      finishReason: candidate?.finishReason,
      usage,
    };
  }

  private toResult(
    data: GeminiResponse,
    request: ChatCompletionRequest,
    conn: GeminiConnection,
    body: Record<string, unknown>,
    started: number,
  ): ChatCompletionResult {
    const parsed = this.parseGeminiResponse(data);

    return {
      text: parsed.text.trim(),
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      provider: InferenceProviderKind.GEMINI_DIRECT,
      baseURL: conn.baseURL,
      model: request.model,
      latencyMs: Date.now() - started,
      rawRequest: body,
      rawResponse: data as unknown as Record<string, unknown>,
    };
  }
}
