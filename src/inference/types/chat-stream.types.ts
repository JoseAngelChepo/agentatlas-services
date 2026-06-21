import type { InferenceProviderKind } from './inference-provider-kind.enum';

export type ChatStreamMeta = {
  provider: InferenceProviderKind;
  baseURL: string;
  model: string;
  timeoutMs: number;
};

export type ChatStreamCallbacks = {
  onMeta?: (meta: ChatStreamMeta) => void;
  onDelta?: (delta: string) => void;
};
