import type { ChatMessage } from '../types/chat-completion.types';

type GeminiPart = { text: string };
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

export type GeminiGenerateRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
  };
};

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed.startsWith('models/')) {
    return trimmed.slice('models/'.length);
  }
  return trimmed;
}

export function geminiModelPath(model: string): string {
  return `models/${normalizeGeminiModel(model)}`;
}

/**
 * Maps chat messages to Gemini `generateContent` / `streamGenerateContent` body.
 * System messages become `systemInstruction`; assistant → model.
 */
export function buildGeminiGenerateRequest(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  jsonMode?: boolean,
): GeminiGenerateRequest {
  const systemParts: GeminiPart[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) {
        systemParts.push({ text: message.content });
      }
      continue;
    }

    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last?.role === role) {
      last.parts.push({ text: message.content });
      continue;
    }

    contents.push({ role, parts: [{ text: message.content }] });
  }

  if (!contents.length) {
    contents.push({ role: 'user', parts: [{ text: '' }] });
  }

  const body: GeminiGenerateRequest = { contents };

  if (systemParts.length) {
    body.systemInstruction = { parts: systemParts };
  }

  const generationConfig: GeminiGenerateRequest['generationConfig'] = {
    temperature,
  };

  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
    generationConfig.maxOutputTokens = Math.max(1, Math.floor(maxTokens));
  }

  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  body.generationConfig = generationConfig;

  return body;
}
