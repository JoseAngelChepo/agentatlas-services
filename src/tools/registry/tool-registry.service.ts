import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { AgentTool, ToolCatalogEntry } from '../types/agent-tool.interface';
import { ToolId } from '../types/tool-id.enum';
import { agentToolToOpenAiFunction } from '../utils/to-openai-function-tool';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import { AGENT_TOOLS } from './agent-tools.token';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<ToolId, AgentTool>();

  constructor(
    @Optional() @Inject(AGENT_TOOLS) agentTools?: AgentTool | AgentTool[],
  ) {
    for (const tool of normalizeAgentTools(agentTools)) {
      this.register(tool);
    }
  }

  list(): ToolCatalogEntry[] {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      configured: tool.isConfigured(),
      inputSchema: tool.inputSchema,
      promptHints: tool.promptHints,
    }));
  }

  get(id: ToolId): AgentTool {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new NotFoundException(`Tool "${id}" is not registered`);
    }
    return tool;
  }

  resolveOpenAiFunctions(toolIds: ToolId[]): OpenAiFunctionToolDefinition[] {
    const definitions: OpenAiFunctionToolDefinition[] = [];

    for (const id of toolIds) {
      if (id === ToolId.RUN_SWARM) {
        this.logger.warn(
          'run_swarm belongs in SwarmAsToolService — omit it from ToolRegistry.resolveOpenAiFunctions',
        );
        continue;
      }

      const tool = this.tools.get(id);
      if (!tool) {
        this.logger.warn(`Agent tool "${id}" is not registered — skipping OpenAI function export`);
        continue;
      }

      definitions.push(agentToolToOpenAiFunction(tool));
    }

    return definitions;
  }

  async executeFunctionCall(
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const toolId = name as ToolId;
    if (!Object.values(ToolId).includes(toolId)) {
      return JSON.stringify({ error: `Unknown tool function: ${name}` });
    }

    if (toolId === ToolId.RUN_SWARM) {
      return JSON.stringify({
        error: 'run_swarm is handled by SwarmAsToolService during inference',
        tool: name,
        retryable: false,
      });
    }

    try {
      const tool = this.get(toolId);
      if (!tool.isConfigured()) {
        return JSON.stringify({ error: `Tool "${name}" is not configured` });
      }

      this.logger.log(`[tool:${name}] agent call args=${JSON.stringify(args)}`);
      const result = await tool.execute(args, context);
      const output = JSON.stringify(result);
      this.logger.log(
        `[tool:${name}] agent result preview=${output.length > 800 ? `${output.slice(0, 800)}… (${output.length} chars total)` : output}`,
      );
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      this.logger.warn(`Tool ${name} failed: ${message}`);
      return JSON.stringify({
        error: message,
        tool: name,
        retryable: false,
      });
    }
  }

  private register(tool: AgentTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate agent tool registration: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
    this.logger.log(`Registered agent tool: ${tool.id}`);
  }
}

function normalizeAgentTools(raw?: AgentTool | AgentTool[]): AgentTool[] {
  if (raw == null) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}
