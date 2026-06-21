import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { InferenceMode } from '../../inference/types/inference-mode.enum';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import { AgentWorkersService } from '../services/agent-workers.service';
import type {
  AgentWorkerExecutor,
  WorkerExecutionResult,
  WorkerExecutionStreamHooks,
} from './worker-executor.interface';
import { LlmWorkerExecutorService } from './llm-worker-executor.service';
import { StubWorkerExecutorService } from './stub-worker-executor.service';

/**
 * Routes worker execution to LLM or stub based on INFERENCE_MODE and provider config.
 */
@Injectable()
export class RoutingWorkerExecutorService implements AgentWorkerExecutor {
  private readonly logger = new Logger(RoutingWorkerExecutorService.name);

  constructor(
    private readonly stubExecutor: StubWorkerExecutorService,
    private readonly llmExecutor: LlmWorkerExecutorService,
    private readonly agentWorkersService: AgentWorkersService,
  ) {}

  supportsStreaming(): boolean {
    return true;
  }

  async execute(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
  ): Promise<WorkerExecutionResult> {
    const executor = await this.resolveExecutor(workerId);
    return executor.execute(workerId, swarmRunId, input);
  }

  async executeStreaming(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
    hooks: WorkerExecutionStreamHooks,
  ): Promise<WorkerExecutionResult> {
    const executor = await this.resolveExecutor(workerId);
    if (executor.executeStreaming) {
      return executor.executeStreaming(workerId, swarmRunId, input, hooks);
    }
    return executor.execute(workerId, swarmRunId, input);
  }

  private async resolveExecutor(workerId: Types.ObjectId): Promise<AgentWorkerExecutor> {
    const mode = this.llmExecutor.inferenceMode();

    if (mode === InferenceMode.STUB) {
      return this.stubExecutor;
    }

    if (mode === InferenceMode.LLM) {
      return this.llmExecutor;
    }

    const worker = await this.agentWorkersService.findById(workerId);
    if (this.llmExecutor.canRunForProvider(worker.model.provider)) {
      return this.llmExecutor;
    }

    this.logger.debug(
      `Provider "${worker.model.provider}" not configured; using stub for worker ${workerId.toString()}`,
    );
    return this.stubExecutor;
  }
}
