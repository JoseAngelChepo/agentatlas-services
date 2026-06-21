import type { ToolExecutionContext } from '../../tools/types/tool-execution-context';

export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<string>;

export type InferenceStreamOptions = {
  onToolCall?: ToolCallHandler;
};
