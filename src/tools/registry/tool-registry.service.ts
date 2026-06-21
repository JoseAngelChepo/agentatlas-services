import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { AgentTool, ToolCatalogEntry } from '../types/agent-tool.interface';
import { ToolId } from '../types/tool-id.enum';
import { capToolResultForModel } from '../utils/cap-tool-result-for-model';
import { agentToolToOpenAiFunction } from '../utils/to-openai-function-tool';
import type { ToolExecutionContext } from '../types/tool-execution-context';
import { AGENT_TOOL_IMPLEMENTATIONS } from './agent-tool-implementations';
import { AGENT_TOOLS } from './agent-tools.token';

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<ToolId, AgentTool>();

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject(AGENT_TOOLS) agentTools?: AgentTool | AgentTool[],
  ) {
    this.registerAll(normalizeAgentTools(agentTools));
  }

  /**
   * ToolsModule ↔ SwarmsModule circular imports can leave `AGENT_TOOLS` empty or partial
   * in the constructor. Resolve every concrete tool class after init.
   */
  onModuleInit(): void {
    for (const ToolClass of AGENT_TOOL_IMPLEMENTATIONS) {
      try {
        const tool = this.moduleRef.get(ToolClass, { strict: false });
        this.register(tool);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Agent tool ${ToolClass.name} not resolved: ${message}`);
      }
    }

    if (this.tools.size === 0) {
      this.logger.error('ToolRegistryService started with zero agent tools');
      return;
    }

    this.logger.log(
      `Tool registry ready (${this.tools.size} tools: ${[...this.tools.keys()].join(', ')})`,
    );
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
      const output = JSON.stringify(capToolResultForModel(result));
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

  private registerAll(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  private register(tool: AgentTool): void {
    if (this.tools.has(tool.id)) {
      return;
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
