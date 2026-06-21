import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { InferenceProviderService } from './inference-provider.service';
import { InferenceMode } from './types/inference-mode.enum';
import { ToolsService } from '../tools/tools.service';

@Controller('inference')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
export class InferenceSetupController {
  constructor(
    private readonly inferenceProvider: InferenceProviderService,
    private readonly config: ConfigService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * Provider catalog + env configuration status for the swarm workspace UI.
   * Does not return secret values.
   */
  @Get('setup')
  getSetup() {
    const modeRaw = this.config.get<string>('INFERENCE_MODE', InferenceMode.AUTO).trim().toLowerCase();
    const mode = (Object.values(InferenceMode) as string[]).includes(modeRaw)
      ? (modeRaw as InferenceMode)
      : InferenceMode.AUTO;

    return {
      mode,
      defaults: {
        provider: this.inferenceProvider.defaultProviderKind(),
        model: this.inferenceProvider.defaultModel(),
        temperature: this.inferenceProvider.defaultTemperature(),
        maxTokens: this.inferenceProvider.defaultMaxTokens() ?? null,
        timeoutMs: this.inferenceProvider.defaultTimeoutMs(),
      },
      providers: this.inferenceProvider.listProviderSetup(),
      workerModelParams: {
        description:
          'Optional keys on agent_workers.model.params: temperature, maxTokens, jsonMode, model (override name).',
        keys: ['temperature', 'maxTokens', 'jsonMode', 'model'],
      },
      openAiResponsesApi: {
        description:
          'openai_direct on api.openai.com uses POST /v1/responses (not chat/completions). Structured output and tools are sent in the Responses request body.',
        docs: 'docs/SWARMS-AGENT-IO.md',
      },
      openaiTools: {
        description:
          'Per-worker tools for the Responses API (web_search, functions, hosted). Example: { "webSearch": true, "toolChoice": "auto" }.',
        keys: [
          'webSearch',
          'webSearchContextSize',
          'webSearchAllowedDomains',
          'toolChoice',
          'functions',
          'hosted',
        ],
        docs: 'docs/SWARMS-AGENT-IO.md#openai-tools-web_search',
      },
      grokTools: {
        description:
          'Per-worker xAI Responses tools (`grok_direct` only). Example: { "xSearch": true, "toolChoice": "auto" }.',
        keys: [
          'xSearch',
          'xSearchAllowedHandles',
          'xSearchExcludedHandles',
          'xSearchFromDate',
          'xSearchToDate',
          'xSearchEnableImageUnderstanding',
          'xSearchEnableVideoUnderstanding',
          'webSearch',
          'toolChoice',
        ],
        docs: 'docs/SWARMS-AGENT-IO.md#grok-tools-x_search',
      },
      agentTools: {
        description:
          'Optional platform tools per worker (`agentTools` on the worker document). Not enabled by default.',
        workerField: 'agentTools',
        catalog: this.toolsService.listTools(),
      },
      swarmTools: {
        description:
          'Optional child swarms per worker (`swarmTools`: swarm id strings). Each id is exposed as `swarm_<objectId>` during inference.',
        workerField: 'swarmTools',
        functionNamePattern: 'swarm_<swarmObjectId>',
        genericToolId: 'run_swarm',
      },
      runInputConvention: {
        input:
          'Use any JSON object in `input` for POST /swarms/:id/run and worker preview (e.g. { summary }, { message }, or both).',
      },
      streaming: {
        swarmRun: 'POST /swarms/:id/run/stream',
        workerPreview: 'POST /agent-workers/:id/run/stream',
        contentType: 'text/event-stream',
        eventsDoc: 'docs/INFERENCE.md#sse-swarm-run-stream',
      },
    };
  }
}
