import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { InferenceProviderService } from '../../inference/inference-provider.service';
import { InferenceMode } from '../../inference/types/inference-mode.enum';
import { buildWorkerChatMessages } from '../../inference/utils/build-worker-messages';
import { hasStructuredOutputSchema } from '../../inference/utils/build-openai-json-schema-format';
import { mergeAgentToolsIntoOpenAiConfig } from '../../tools/utils/merge-agent-tools-into-openai-config';
import {
  buildWorkerToolsPromptBlock,
  collectWorkerToolPromptEntries,
} from '../../tools/utils/build-worker-tools-prompt-block';
import { parseAgentToolIds } from '../../tools/utils/parse-agent-tool-ids';
import {
  shouldExposeRunSwarmTool,
  splitRegistryAgentToolIds,
} from '../../tools/utils/split-registry-agent-tool-ids';
import { parseSwarmToolIds } from '../../tools/utils/parse-swarm-tool-ids';
import { ToolRegistryService } from '../../tools/registry/tool-registry.service';
import { SwarmAsToolService } from '../services/swarm-as-tool.service';
import { parseGrokWorkerTools } from '../../inference/utils/parse-grok-worker-tools';
import { parseOpenAiWorkerTools } from '../../inference/utils/parse-openai-worker-tools';
import { normalizeInferenceProvider } from '../../inference/utils/normalize-inference-provider';
import { parseWorkerLlmOutput } from '../../inference/utils/parse-worker-output';
import { resolveWorkerLlmParams } from '../../inference/utils/resolve-worker-llm-params';
import { AgentRunMessageRole } from '../schemas/agent-run.schema';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import { AgentRunsService } from '../services/agent-runs.service';
import { AgentWorkersService } from '../services/agent-workers.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import type {
  AgentWorkerExecutor,
  WorkerExecutionResult,
  WorkerExecutionStreamHooks,
} from './worker-executor.interface';

@Injectable()
export class LlmWorkerExecutorService implements AgentWorkerExecutor {
  constructor(
    private readonly config: ConfigService,
    private readonly inferenceProvider: InferenceProviderService,
    private readonly agentWorkersService: AgentWorkersService,
    private readonly agentRunsService: AgentRunsService,
    private readonly swarmRunsService: SwarmRunsService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly swarmAsToolService: SwarmAsToolService,
  ) {}

  supportsStreaming(): boolean {
    return true;
  }

  async execute(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
  ): Promise<WorkerExecutionResult> {
    return this.executeStreaming(workerId, swarmRunId, input, {});
  }

  async executeStreaming(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
    hooks: WorkerExecutionStreamHooks,
  ): Promise<WorkerExecutionResult> {
    const started = Date.now();
    const worker = await this.agentWorkersService.findById(workerId);
    const swarmRun = await this.swarmRunsService.findById(swarmRunId.toString());
    const llm = resolveWorkerLlmParams(worker.model, {
      defaultModel: this.inferenceProvider.defaultModel(),
      defaultTemperature: this.inferenceProvider.defaultTemperature(),
      defaultMaxTokens: this.inferenceProvider.defaultMaxTokens(),
    });

    const providerKind = normalizeInferenceProvider(llm.provider);
    const outputSchema =
      worker.outputSchema && typeof worker.outputSchema === 'object'
        ? (worker.outputSchema as Record<string, unknown>)
        : undefined;
    const useStructuredOutput = hasStructuredOutputSchema(outputSchema);
    const grokTools = parseGrokWorkerTools(worker.grokTools);
    const swarmToolIds = parseSwarmToolIds(worker.swarmTools);
    const parsedAgentTools = parseAgentToolIds(worker.agentTools);
    const { registryToolIds, includesRunSwarm } = splitRegistryAgentToolIds(parsedAgentTools);
    const exposeRunSwarm = shouldExposeRunSwarmTool(includesRunSwarm, swarmToolIds);
    const resolvedSwarmTools = await this.swarmAsToolService.resolveSwarmTools(
      swarmToolIds,
      swarmRun.triggeredBy.toString(),
    );
    const swarmToolFunctions = resolvedSwarmTools.map((row) => row.function);
    const parentRunInput = (swarmRun.input as Record<string, unknown> | undefined) ?? undefined;
    const openaiTools = mergeAgentToolsIntoOpenAiConfig(
      parseOpenAiWorkerTools(worker.openaiTools),
      [
        ...this.toolRegistry.resolveOpenAiFunctions(registryToolIds),
        ...swarmToolFunctions,
        ...(exposeRunSwarm ? [this.swarmAsToolService.runSwarmFunctionDefinition()] : []),
      ],
    );
    const hasExecutableFunctions = (openaiTools.functions?.length ?? 0) > 0;
    const toolsPromptBlock = hasExecutableFunctions
      ? buildWorkerToolsPromptBlock(
          collectWorkerToolPromptEntries({
            registryToolIds,
            includesRunSwarm: exposeRunSwarm,
            swarmToolFunctions,
            swarmToolPromptSpecs: resolvedSwarmTools.map((row) => row.promptSpec),
            parentRunInput,
            registryCatalog: this.toolRegistry.list(),
            runSwarmCatalog: this.swarmAsToolService.runSwarmCatalogEntry(),
          }),
          { hasSwarmTools: resolvedSwarmTools.length > 0, hasRegistryTools: registryToolIds.length > 0 },
        )
      : null;
    const messages = buildWorkerChatMessages(input, { toolsPromptBlock });
    const enrichedInput: AgentWorkerRunInput = {
      ...input,
      connectedAgentTools: registryToolIds,
    };
    const agentRun = await this.agentRunsService.createPending(workerId, swarmRunId, enrichedInput);

    const timeoutMs = Math.min(
      worker.timeoutMs,
      this.inferenceProvider.defaultTimeoutMs(),
    );
    const requestPayload = {
      provider: providerKind,
      model: llm.model,
      messages,
      temperature: llm.temperature,
      maxTokens: llm.maxTokens,
      timeoutMs,
      jsonMode: llm.jsonMode || useStructuredOutput,
      outputSchema: useStructuredOutput ? outputSchema : undefined,
      structuredOutputName: worker.name,
      openaiTools,
      grokTools,
    };

    try {
      const completion = await this.inferenceProvider.streamChatCompletion(
        requestPayload,
        {
          onMeta: (meta) => {
            hooks.onMeta?.({
              provider: meta.provider,
              model: meta.model,
              baseURL: meta.baseURL,
            });
          },
          onDelta: (delta) => hooks.onDelta?.(delta),
        },
        `worker-${workerId.toString()}`,
        hasExecutableFunctions
          ? {
              onToolCall: (name, args) => {
                const toolContext = {
                  userId: swarmRun.triggeredBy.toString(),
                  swarmRunId: swarmRunId.toString(),
                  agentRunId: agentRun._id.toString(),
                  allowedSwarmToolIds: swarmToolIds,
                };

                if (this.swarmAsToolService.isSwarmToolFunctionName(name)) {
                  return this.swarmAsToolService.executeFunctionCall(name, args, toolContext);
                }

                return this.toolRegistry.executeFunctionCall(name, args, toolContext);
              },
            }
          : undefined,
      );

      const output = parseWorkerLlmOutput(completion.text, {
        preferJson: llm.jsonMode || useStructuredOutput,
      });

      const runMessages = [
        ...messages.map((m) => ({
          role:
            m.role === 'assistant'
              ? AgentRunMessageRole.ASSISTANT
              : m.role === 'system'
                ? AgentRunMessageRole.SYSTEM
                : AgentRunMessageRole.USER,
          content: m.content,
          tokensUsed: 0,
          timestamp: new Date(),
        })),
        {
          role: AgentRunMessageRole.ASSISTANT,
          content: completion.text,
          tokensUsed: completion.usage?.completionTokens ?? 0,
          timestamp: new Date(),
        },
      ];

      const inference = {
        request: {
          ...(completion.rawRequest ??
            ({
              model: llm.model,
              messages,
              temperature: llm.temperature,
              maxTokens: llm.maxTokens,
              jsonMode: llm.jsonMode,
              outputSchema: useStructuredOutput ? outputSchema : undefined,
            } as Record<string, unknown>)),
          connectedAgentTools: registryToolIds,
          toolFunctionsExposed: (openaiTools.functions ?? []).map((fn) => fn.name),
          toolsPromptAttached: Boolean(toolsPromptBlock),
          toolChoice: openaiTools.toolChoice ?? null,
        },
        response: {
          provider: completion.provider,
          baseURL: completion.baseURL,
          model: completion.model,
          text: completion.text,
          finishReason: completion.finishReason,
          usage: completion.usage,
          latencyMs: completion.latencyMs,
          raw: completion.rawResponse ?? null,
        },
      };

      await this.agentRunsService.complete(agentRun._id, output, Date.now() - started, {
        messages: runMessages,
        inference,
      });

      return {
        output,
        agentRunId: agentRun._id,
        inference,
        messages: runMessages.map((m) => ({
          role: m.role,
          content: m.content,
          tokensUsed: m.tokensUsed,
        })),
      };
    } catch (err) {
      await this.agentRunsService.markFailed(agentRun._id, Date.now() - started);
      throw err;
    }
  }

  inferenceMode(): InferenceMode {
    const raw = this.config.get<string>('INFERENCE_MODE', InferenceMode.AUTO).trim().toLowerCase();
    if ((Object.values(InferenceMode) as string[]).includes(raw)) {
      return raw as InferenceMode;
    }
    return InferenceMode.AUTO;
  }

  canRunForProvider(provider: string): boolean {
    const kind = normalizeInferenceProvider(provider);
    return this.inferenceProvider.isProviderConfigured(kind);
  }
}
