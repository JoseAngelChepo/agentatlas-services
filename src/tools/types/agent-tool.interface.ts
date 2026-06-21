import type { ToolExecutionContext } from './tool-execution-context';
import type { ToolId } from './tool-id.enum';
import type { ToolInputSchema } from './tool-input-schema.types';

/** Optional LLM-facing guidance appended to the worker system prompt when the tool is connected. */
export type AgentToolPromptHints = {
  whenToUse: string;
  inputGuide: string;
  outputGuide: string;
};

export type ToolCatalogEntry = {
  id: ToolId;
  name: string;
  description: string;
  configured: boolean;
  inputSchema: ToolInputSchema;
  promptHints?: AgentToolPromptHints;
};

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly promptHints?: AgentToolPromptHints;
  isConfigured(): boolean;
  execute(input: TInput, context?: ToolExecutionContext): Promise<TOutput>;
}
