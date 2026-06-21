import type { AgentTool, ToolCatalogEntry, AgentToolPromptHints } from '../types/agent-tool.interface';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import type { ToolInputSchema } from '../types/tool-input-schema.types';
import type { ToolId } from '../types/tool-id.enum';
import { requireToolUserId } from './require-tool-context';

/**
 * Base class for platform agent tools (`agentTools` on workers).
 *
 * To add a tool:
 * 1. Add its id to `ToolId`.
 * 2. Create `types/<name>.types.ts` for input/output.
 * 3. Create `implementations/<name>.tool.ts` extending this class.
 * 4. Register with `registerAgentTool()` in `tools.module.ts`.
 */
export abstract class BaseAgentTool<TInput = unknown, TOutput = unknown>
  implements AgentTool<TInput, TOutput>
{
  abstract readonly id: ToolId;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: ToolInputSchema;
  readonly promptHints?: AgentToolPromptHints;

  abstract isConfigured(): boolean;
  abstract execute(input: TInput, context?: ToolExecutionContext): Promise<TOutput>;

  protected constructor() {}

  toCatalogEntry(): ToolCatalogEntry {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      configured: this.isConfigured(),
      inputSchema: this.inputSchema,
      promptHints: this.promptHints,
    };
  }

  protected requireUserId(context?: ToolExecutionContext): string {
    return requireToolUserId(this.id, context);
  }
}
