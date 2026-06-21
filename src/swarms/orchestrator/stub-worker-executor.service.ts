import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildWorkerChatMessages } from '../../inference/utils/build-worker-messages';
import { AgentRunMessageRole } from '../schemas/agent-run.schema';
import { AgentRunsService } from '../services/agent-runs.service';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import type {
  AgentWorkerExecutor,
  WorkerExecutionResult,
  WorkerExecutionStreamHooks,
} from './worker-executor.interface';

/**
 * Placeholder executor until LLM providers are wired.
 * Persists agent_runs and returns a structured stub output.
 */
@Injectable()
export class StubWorkerExecutorService implements AgentWorkerExecutor {
  constructor(private readonly agentRunsService: AgentRunsService) {}

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
    hooks.onMeta?.({ provider: 'stub', model: 'stub', baseURL: '' });

    const started = Date.now();
    const agentRun = await this.agentRunsService.createPending(workerId, swarmRunId, input);

    const output: Record<string, unknown> = {
      workerId: workerId.toString(),
      stub: true,
      upstreamCount: input.upstream.length,
      goal: input.goal,
    };
    const runMessages = buildWorkerChatMessages(input).map((m) => ({
      role:
        m.role === 'assistant'
          ? AgentRunMessageRole.ASSISTANT
          : m.role === 'system'
            ? AgentRunMessageRole.SYSTEM
            : AgentRunMessageRole.USER,
      content: m.content,
      tokensUsed: 0,
      timestamp: new Date(),
    }));

    hooks.onDelta?.(JSON.stringify(output, null, 2));

    const inference = {
      request: {
        model: 'stub',
        messages: runMessages.map((m) => ({ role: m.role, content: m.content })),
      },
      response: {
        model: 'stub',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        text: JSON.stringify(output, null, 2),
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
  }
}
