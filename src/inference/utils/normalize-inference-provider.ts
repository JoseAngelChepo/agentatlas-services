import { InferenceProviderKind } from '../types/inference-provider-kind.enum';

const ALIASES: Record<string, InferenceProviderKind> = {
  openai: InferenceProviderKind.OPENAI_DIRECT,
  openai_direct: InferenceProviderKind.OPENAI_DIRECT,
  anthropic: InferenceProviderKind.CLAUDE_DIRECT,
  claude: InferenceProviderKind.CLAUDE_DIRECT,
  claude_direct: InferenceProviderKind.CLAUDE_DIRECT,
  openrouter: InferenceProviderKind.OPENROUTER,
  huggingface: InferenceProviderKind.HUGGING_FACE,
  hugging_face: InferenceProviderKind.HUGGING_FACE,
  hf: InferenceProviderKind.HUGGING_FACE,
  inference_net: InferenceProviderKind.INFERENCE_NET,
  'inference.net': InferenceProviderKind.INFERENCE_NET,
  ollama: InferenceProviderKind.OLLAMA,
  grok: InferenceProviderKind.GROK_DIRECT,
  grok_direct: InferenceProviderKind.GROK_DIRECT,
  xai: InferenceProviderKind.GROK_DIRECT,
  gemini: InferenceProviderKind.GEMINI_DIRECT,
  gemini_direct: InferenceProviderKind.GEMINI_DIRECT,
  google: InferenceProviderKind.GEMINI_DIRECT,
  google_gemini: InferenceProviderKind.GEMINI_DIRECT,
};

export function normalizeInferenceProvider(value: string | undefined): InferenceProviderKind {
  const key = (value ?? '').trim().toLowerCase();
  if (isInferenceProviderKind(key)) {
    return key;
  }
  return ALIASES[key] ?? InferenceProviderKind.OPENAI_DIRECT;
}

export function isInferenceProviderKind(value: string): value is InferenceProviderKind {
  return (Object.values(InferenceProviderKind) as string[]).includes(value);
}
