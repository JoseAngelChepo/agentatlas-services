import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgentRun, AgentRunDocument, AgentRunMessage } from '../schemas/agent-run.schema';
import { RunStatus } from '../types/run-status.enum';
import type { AgentWorkerRunInput } from '../context/swarm-context.types';
import { SwarmRunsService } from './swarm-runs.service';

@Injectable()
export class AgentRunsService {
  constructor(
    @InjectModel(AgentRun.name)
    private readonly agentRunModel: Model<AgentRunDocument>,
    private readonly swarmRunsService: SwarmRunsService,
  ) {}

  async createPending(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: AgentWorkerRunInput,
  ): Promise<AgentRunDocument> {
    return this.agentRunModel.create({
      workerId,
      swarmRunId,
      input: input as unknown as Record<string, unknown>,
      status: RunStatus.RUNNING,
    });
  }

  async findBySwarmRunForUser(userId: string, swarmRunId: string): Promise<AgentRunDocument[]> {
    await this.swarmRunsService.findByIdForUser(userId, swarmRunId);
    return this.agentRunModel
      .find({ swarmRunId: new Types.ObjectId(swarmRunId) })
      .sort({ createdAt: 1 })
      .exec();
  }

  async findBySwarmRunAdmin(swarmRunId: string): Promise<AgentRunDocument[]> {
    await this.swarmRunsService.findById(swarmRunId);
    return this.findBySwarmRun(new Types.ObjectId(swarmRunId));
  }

  async findBySwarmRun(swarmRunId: Types.ObjectId): Promise<AgentRunDocument[]> {
    return this.agentRunModel.find({ swarmRunId }).sort({ createdAt: 1 }).exec();
  }

  async findBySwarmRunIds(swarmRunIds: Types.ObjectId[]): Promise<AgentRunDocument[]> {
    if (swarmRunIds.length === 0) {
      return [];
    }
    return this.agentRunModel
      .find({ swarmRunId: { $in: swarmRunIds } })
      .sort({ swarmRunId: 1, createdAt: 1 })
      .exec();
  }

  async getMaxUpdatedAtForSwarmIds(swarmIds: Types.ObjectId[]): Promise<Date | null> {
    if (swarmIds.length === 0) {
      return null;
    }

    const rows = await this.agentRunModel
      .aggregate<{ updatedAt?: Date }>([
        {
          $lookup: {
            from: 'swarm_runs',
            localField: 'swarmRunId',
            foreignField: '_id',
            as: 'run',
          },
        },
        { $unwind: '$run' },
        { $match: { 'run.swarmId': { $in: swarmIds } } },
        { $sort: { updatedAt: -1 } },
        { $limit: 1 },
        { $project: { updatedAt: 1 } },
      ])
      .exec();

    return rows[0]?.updatedAt ?? null;
  }

  async complete(
    id: Types.ObjectId,
    output: Record<string, unknown>,
    durationMs: number,
    extra?: {
      messages?: AgentRunMessage[];
      attempt?: number;
      inference?: {
        request?: Record<string, unknown> | null;
        response?: Record<string, unknown> | null;
      };
    },
  ): Promise<AgentRunDocument> {
    const $set: Record<string, unknown> = {
      output,
      status: RunStatus.DONE,
      durationMs,
    };
    if (extra?.messages) {
      $set.messages = extra.messages;
    }
    if (extra?.attempt !== undefined) {
      $set.attempt = extra.attempt;
    }
    if (extra?.inference) {
      $set.inference = {
        request: extra.inference.request ?? null,
        response: extra.inference.response ?? null,
      };
    }

    const doc = await this.agentRunModel
      .findByIdAndUpdate(id, { $set }, { new: true })
      .exec();
    if (!doc) {
      throw new NotFoundException('Agent run not found');
    }
    return doc;
  }

  async markFailed(id: Types.ObjectId, durationMs: number): Promise<void> {
    await this.agentRunModel
      .findByIdAndUpdate(id, { status: RunStatus.FAILED, durationMs })
      .exec();
  }
}
