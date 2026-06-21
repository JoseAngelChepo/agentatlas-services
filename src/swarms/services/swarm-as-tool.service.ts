import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { ToolCatalogEntry } from '../../tools/types/agent-tool.interface';
import { ToolId } from '../../tools/types/tool-id.enum';
import type { RunSwarmToolInput, RunSwarmToolOutput } from '../../tools/types/run-swarm.types';
import type { SwarmDocument } from '../schemas/swarm.schema';
import {
  forwardChildSwarmRunInput,
  forwardParentRunInputDefaults,
  normalizeToolPayloadForChildContract,
} from '../orchestrator/evaluate-swarm-node';
import { SwarmOrchestratorService } from '../orchestrator/swarm-orchestrator.service';
import { SwarmAccessService } from './swarm-access.service';
import { AgentWorkersService } from './agent-workers.service';
import { SwarmGraphsService } from './swarm-graphs.service';
import { SwarmRunsService } from './swarm-runs.service';
import { SwarmsService } from './swarms.service';
import { type SwarmToolExecutionContext } from '../types/swarm-tool.types';
import {
  buildSwarmToolOpenAiParameters,
  type SwarmToolPromptSpec,
} from '../utils/build-swarm-tool-input-contract';
import {
  extractSwarmRunInputFieldNames,
} from '../utils/extract-swarm-io-contract';
import { collectWorkerIdsFromGraph } from '../utils/graph-index';
import {
  parseSwarmIdFromToolFunctionName,
  swarmToolFunctionName,
} from '../utils/swarm-tool-function-name';

function buildSwarmToolDescription(swarm: SwarmDocument): string {
  const summary = swarm.description?.trim() || swarm.goal?.trim() || 'No description';
  return `Run swarm "${swarm.name}": ${summary}`;
}

export type ResolvedSwarmTool = {
  function: OpenAiFunctionToolDefinition;
  promptSpec: SwarmToolPromptSpec;
};

@Injectable()
export class SwarmAsToolService {
  private readonly logger = new Logger(SwarmAsToolService.name);

  constructor(
    private readonly swarmsService: SwarmsService,
    private readonly swarmGraphsService: SwarmGraphsService,
    private readonly agentWorkersService: AgentWorkersService,
    private readonly swarmAccessService: SwarmAccessService,
    private readonly swarmRunsService: SwarmRunsService,
    @Inject(forwardRef(() => SwarmOrchestratorService))
    private readonly swarmOrchestrator: SwarmOrchestratorService,
  ) {}

  isSwarmToolFunctionName(name: string): boolean {
    return name === ToolId.RUN_SWARM || parseSwarmIdFromToolFunctionName(name) != null;
  }

  runSwarmCatalogEntry(): ToolCatalogEntry {
    return {
      id: ToolId.RUN_SWARM,
      name: 'Run swarm',
      description:
        'Execute another swarm by id and return its final output. Prefer swarm_<objectId> when listed in swarmTools.',
      configured: true,
      promptHints: {
        whenToUse:
          'When no dedicated swarm_<id> function fits, or you must run a swarm by MongoDB id.',
        inputGuide:
          'Call with `{ "swarmId": "<24-char hex>", "input": { ... } }`. Put the user task in `input.message` (or related fields). `input` is optional but recommended.',
        outputGuide:
          'JSON with `status`, `output`, `swarmRunId`, and optional `error`. When `status` is `done`, base your answer on `output`.',
      },
      inputSchema: {
        type: 'object',
        required: ['swarmId'],
        properties: {
          swarmId: {
            type: 'string',
            description: 'MongoDB id of the swarm to execute',
          },
          input: {
            type: 'object',
            description: 'Optional JSON payload for the child swarm run input',
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
    };
  }

  runSwarmFunctionDefinition(): OpenAiFunctionToolDefinition {
    const catalog = this.runSwarmCatalogEntry();
    return {
      name: catalog.id,
      description: catalog.description,
      parameters: catalog.inputSchema,
      strict: false,
    };
  }

  async resolveFunctionDefinitions(
    swarmIds: string[],
    userId: string,
  ): Promise<OpenAiFunctionToolDefinition[]> {
    const resolved = await this.resolveSwarmTools(swarmIds, userId);
    return resolved.map((row) => row.function);
  }

  async resolveSwarmTools(swarmIds: string[], userId: string): Promise<ResolvedSwarmTool[]> {
    const validIds = swarmIds.filter((id) => Types.ObjectId.isValid(id));
    const graphs =
      validIds.length > 0
        ? await this.swarmGraphsService.findManyBySwarmIds(validIds)
        : new Map();

    const resolved: ResolvedSwarmTool[] = [];

    for (const swarmId of swarmIds) {
      if (!Types.ObjectId.isValid(swarmId)) {
        continue;
      }

      try {
        await this.swarmAccessService.assertCanRun(userId, swarmId);
        const swarm = await this.swarmsService.findById(swarmId);
        const graph = graphs.get(swarmId) ?? null;
        const inputNames = await this.resolveChildInputNames(swarmId, swarm, graph);
        const functionName = swarmToolFunctionName(swarmId);
        const description = buildSwarmToolDescription(swarm);

        resolved.push({
          function: {
            name: functionName,
            description,
            parameters: buildSwarmToolOpenAiParameters(inputNames),
            strict: false,
          },
          promptSpec: {
            functionName,
            swarmId,
            swarmName: swarm.name,
            description,
            inputNames,
          },
        });
      } catch {
        // Skip swarms the user cannot run (stale worker config).
      }
    }

    return resolved;
  }

  async executeFunctionCall(
    name: string,
    args: Record<string, unknown>,
    context: SwarmToolExecutionContext,
  ): Promise<string> {
    try {
      const swarmId = this.resolveSwarmId(name, args, context.allowedSwarmToolIds);
      const childInput = await this.buildChildRunInput(name, args, context.swarmRunId, swarmId);
      this.logger.log(
        `[swarm-tool:${name}] childInput keys=${Object.keys(childInput).join(',') || '(empty)'}`,
      );
      const result = await this.swarmOrchestrator.runSwarmAsAgentTool({
        childSwarmId: swarmId,
        childInput,
        userId: context.userId,
        parentSwarmRunId: context.swarmRunId,
      });

      const output: RunSwarmToolOutput = {
        swarmRunId: result.swarmRunId,
        status: result.status,
        output: result.output,
        error: result.error,
      };

      this.logger.log(
        `[swarm-tool:${name}] swarmRunId=${output.swarmRunId} status=${output.status}`,
      );

      return JSON.stringify(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Swarm tool execution failed';
      this.logger.warn(`Swarm tool ${name} failed: ${message}`);
      return JSON.stringify({
        error: message,
        tool: name,
        retryable: false,
      });
    }
  }

  async runSwarmTool(
    input: RunSwarmToolInput,
    context: SwarmToolExecutionContext,
  ): Promise<RunSwarmToolOutput> {
    const swarmId = input.swarmId?.trim() ?? '';
    if (!Types.ObjectId.isValid(swarmId)) {
      throw new BadRequestException('swarmId must be a valid swarm id');
    }

    this.assertSwarmAllowed(swarmId, context.allowedSwarmToolIds);
    await this.swarmAccessService.assertCanRun(context.userId, swarmId);

    const childInput = await this.buildChildRunInput(
      ToolId.RUN_SWARM,
      { swarmId, input: input.input ?? {} },
      context.swarmRunId,
      swarmId,
    );
    const result = await this.swarmOrchestrator.runSwarmAsAgentTool({
      childSwarmId: swarmId,
      childInput,
      userId: context.userId,
      parentSwarmRunId: context.swarmRunId,
    });

    return {
      swarmRunId: result.swarmRunId,
      status: result.status,
      output: result.output,
      error: result.error,
    };
  }

  private resolveSwarmId(
    name: string,
    args: Record<string, unknown>,
    allowedSwarmToolIds?: string[],
  ): string {
    if (name === ToolId.RUN_SWARM) {
      const swarmId = typeof args.swarmId === 'string' ? args.swarmId.trim() : '';
      if (!Types.ObjectId.isValid(swarmId)) {
        throw new BadRequestException('run_swarm requires a valid swarmId');
      }
      this.assertSwarmAllowed(swarmId, allowedSwarmToolIds);
      return swarmId;
    }

    const swarmId = parseSwarmIdFromToolFunctionName(name);
    if (!swarmId) {
      throw new BadRequestException(`Unknown swarm tool function: ${name}`);
    }

    this.assertSwarmAllowed(swarmId, allowedSwarmToolIds);
    return swarmId;
  }

  private assertSwarmAllowed(swarmId: string, allowedSwarmToolIds?: string[]): void {
    if (!allowedSwarmToolIds?.length) {
      return;
    }
    if (!allowedSwarmToolIds.includes(swarmId)) {
      throw new BadRequestException(`Swarm "${swarmId}" is not enabled on this worker`);
    }
  }

  private async buildChildRunInput(
    name: string,
    args: Record<string, unknown>,
    parentSwarmRunId?: string,
    childSwarmId?: string,
  ): Promise<Record<string, unknown>> {
    const payload =
      name === ToolId.RUN_SWARM
        ? this.normalizeRunSwarmInput(args)
        : this.extractRunInput(args);

    if (!parentSwarmRunId) {
      return payload;
    }

    const parentRun = await this.swarmRunsService.findById(parentSwarmRunId);
    const parentInput = (parentRun.input as Record<string, unknown>) ?? {};
    const childInputNames = childSwarmId
      ? await this.resolveChildInputNames(childSwarmId)
      : [];
    const normalizedPayload = normalizeToolPayloadForChildContract(payload, childInputNames);
    const merged = {
      ...(childInputNames.length > 0
        ? forwardChildSwarmRunInput(parentInput, normalizedPayload, childInputNames)
        : forwardParentRunInputDefaults(parentInput, normalizedPayload)),
    };
    const previewKey = childInputNames[0] ?? 'message';
    const previewValue = merged[previewKey];
    this.logger.log(
      `[swarm-tool] childInput ${previewKey}=${typeof previewValue === 'string' ? `"${previewValue.slice(0, 80)}${previewValue.length > 80 ? '…' : ''}"` : '(missing)'}`,
    );
    return merged;
  }

  private async resolveChildInputNames(
    childSwarmId: string,
    swarm?: SwarmDocument,
    graph?: Awaited<ReturnType<SwarmGraphsService['findBySwarmIdOptional']>> | null,
  ): Promise<string[]> {
    const resolvedGraph =
      graph !== undefined
        ? graph
        : await this.swarmGraphsService.findBySwarmIdOptional(childSwarmId);

    const workerIdSet = new Set<string>();
    if (swarm) {
      for (const workerId of swarm.workers ?? []) {
        workerIdSet.add(workerId.toString());
      }
    }
    if (resolvedGraph) {
      for (const workerId of collectWorkerIdsFromGraph(resolvedGraph)) {
        workerIdSet.add(workerId.toString());
      }
    }

    const workers =
      workerIdSet.size > 0
        ? [...(await this.agentWorkersService.findByIds([...workerIdSet].map((id) => new Types.ObjectId(id)))).values()]
        : [];

    return extractSwarmRunInputFieldNames(resolvedGraph, workers);
  }

  private normalizeRunSwarmInput(args: Record<string, unknown>): Record<string, unknown> {
    if (args.input && typeof args.input === 'object' && !Array.isArray(args.input)) {
      return args.input as Record<string, unknown>;
    }
    const { swarmId: _swarmId, ...rest } = args;
    return rest;
  }

  private extractRunInput(args: Record<string, unknown>): Record<string, unknown> {
    if (args.input && typeof args.input === 'object' && !Array.isArray(args.input)) {
      return args.input as Record<string, unknown>;
    }
    return args;
  }
}
