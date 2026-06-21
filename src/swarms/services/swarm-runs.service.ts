import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { assertSwarmOwner } from '../utils/assert-swarm-owner';
import { SwarmRun, SwarmRunDocument } from '../schemas/swarm-run.schema';
import { RunStatus } from '../types/run-status.enum';
import { SwarmRunKind } from '../types/swarm-run-kind.enum';
import type { SwarmRunCheckpoint } from '../types/swarm-run-checkpoint.types';
import type { SwarmRunCheckpointDoc } from '../schemas/swarm-run-checkpoint.schema';
import { SwarmAccessService } from './swarm-access.service';
import { SwarmsService } from './swarms.service';
import type { SwarmRunStats } from '../stats/aggregate-swarm-run-stats';

@Injectable()
export class SwarmRunsService {
  constructor(
    @InjectModel(SwarmRun.name)
    private readonly swarmRunModel: Model<SwarmRunDocument>,
    private readonly swarmsService: SwarmsService,
    private readonly swarmAccessService: SwarmAccessService,
  ) {}

  async createRunning(
    swarmId: Types.ObjectId,
    triggeredBy: string,
    input: Record<string, unknown>,
    runKind: SwarmRunKind = SwarmRunKind.SWARM,
    parent?: {
      parentSwarmRunId: Types.ObjectId;
      parentNodeId: string;
      depth: number;
    },
  ): Promise<SwarmRunDocument> {
    return this.swarmRunModel.create({
      swarmId,
      triggeredBy: new Types.ObjectId(triggeredBy),
      input,
      runKind,
      status: RunStatus.RUNNING,
      parentSwarmRunId: parent?.parentSwarmRunId ?? null,
      parentNodeId: parent?.parentNodeId ?? null,
      depth: parent?.depth ?? 0,
    });
  }

  async findById(id: string): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }

  async findByIdForUser(userId: string, id: string): Promise<SwarmRunDocument> {
    const doc = await this.findById(id);
    assertSwarmOwner(userId, doc.triggeredBy);
    return doc;
  }

  async findByPendingNeedsInputId(needsInputId: string): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel.findOne({ pendingNeedsInputId: needsInputId }).exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found for needs input');
    }
    return doc;
  }

  async findAllForSwarm(userId: string, swarmId: string): Promise<SwarmRunDocument[]> {
    const swarm = await this.swarmAccessService.assertCanRun(userId, swarmId);
    const filter: FilterQuery<SwarmRunDocument> = {
      swarmId: new Types.ObjectId(swarmId),
    };

    if (!this.swarmAccessService.isOwner(userId, swarm)) {
      filter.triggeredBy = new Types.ObjectId(userId);
    }

    return this.swarmRunModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findInFlightForSwarmIds(
    userId: string,
    swarmIds: Types.ObjectId[],
  ): Promise<SwarmRunDocument[]> {
    if (swarmIds.length === 0) {
      return [];
    }

    return this.swarmRunModel
      .find({
        triggeredBy: new Types.ObjectId(userId),
        swarmId: { $in: swarmIds },
        status: RunStatus.RUNNING,
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();
  }

  async getMaxUpdatedAtForSwarmIds(swarmIds: Types.ObjectId[]): Promise<Date | null> {
    if (swarmIds.length === 0) {
      return null;
    }

    const row = await this.swarmRunModel
      .findOne({ swarmId: { $in: swarmIds } })
      .sort({ updatedAt: -1 })
      .select('updatedAt')
      .lean<{ updatedAt?: Date }>()
      .exec();

    return row?.updatedAt ?? null;
  }

  async findAllForSwarmAdmin(swarmId: string, limit = 40): Promise<SwarmRunDocument[]> {
    await this.swarmsService.adminFindOne(swarmId);
    return this.swarmRunModel
      .find({ swarmId: new Types.ObjectId(swarmId), runKind: SwarmRunKind.SWARM })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async appendAgentRun(swarmRunId: Types.ObjectId, agentRunId: Types.ObjectId): Promise<void> {
    await this.swarmRunModel
      .findByIdAndUpdate(swarmRunId, { $push: { agentRuns: agentRunId } })
      .exec();
  }

  async pauseForApproval(
    id: Types.ObjectId,
    checkpoint: SwarmRunCheckpoint,
    approvalId: Types.ObjectId,
  ): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel
      .findByIdAndUpdate(
        id,
        {
          status: RunStatus.AWAITING_APPROVAL,
          pendingApprovalId: approvalId,
          pendingNeedsInputId: null,
          checkpoint: checkpoint as SwarmRunCheckpointDoc,
        },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }

  async pauseForInput(
    id: Types.ObjectId,
    checkpoint: SwarmRunCheckpoint,
    needsInputId: string,
  ): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel
      .findByIdAndUpdate(
        id,
        {
          status: RunStatus.AWAITING_INPUT,
          pendingApprovalId: null,
          pendingNeedsInputId: needsInputId,
          checkpoint: checkpoint as SwarmRunCheckpointDoc,
        },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }

  async markRunningAfterApproval(id: Types.ObjectId): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel
      .findByIdAndUpdate(
        id,
        {
          status: RunStatus.RUNNING,
          pendingApprovalId: null,
        },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }

  async markRunningAfterInput(id: Types.ObjectId): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel
      .findByIdAndUpdate(
        id,
        {
          status: RunStatus.RUNNING,
          pendingNeedsInputId: null,
        },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }

  async clearCheckpoint(id: Types.ObjectId): Promise<void> {
    await this.swarmRunModel.findByIdAndUpdate(id, { checkpoint: null }).exec();
  }

  async finish(
    id: Types.ObjectId,
    output: Record<string, unknown> | null,
    stats: SwarmRunStats,
    status: RunStatus.DONE | RunStatus.FAILED,
    failureReason = '',
  ): Promise<SwarmRunDocument> {
    const doc = await this.swarmRunModel
      .findByIdAndUpdate(
        id,
        {
          output,
          durationMs: stats.durationMs,
          promptTokens: stats.promptTokens,
          completionTokens: stats.completionTokens,
          totalTokens: stats.totalTokens,
          costUsd: stats.costUsd,
          scrapeCostUsd: stats.scrapeCostUsd,
          totalCostUsd: stats.totalCostUsd,
          usageByModel: stats.usageByModel,
          scrapeUsage: stats.scrapeUsage,
          status,
          failureReason,
        },
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Swarm run not found');
    }
    return doc;
  }
}
