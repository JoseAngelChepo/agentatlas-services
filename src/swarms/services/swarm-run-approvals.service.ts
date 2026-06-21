import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { SwarmDocument } from '../schemas/swarm.schema';
import {
  SwarmRunApproval,
  SwarmRunApprovalDocument,
} from '../schemas/swarm-run-approval.schema';
import { SwarmRunApprovalStatus } from '../types/swarm-run-approval-status.enum';
import type { UserApprovalNodeData } from '../types/user-approval-node.types';
import { parseUserApprovalNodeData } from '../utils/graph-index';
import { serializeSwarmRunApproval } from '../utils/swarm-run-approval-serializers';

export type CreateSwarmRunApprovalParams = {
  swarmRunId: Types.ObjectId;
  swarm: SwarmDocument;
  nodeId: string;
  nodeData: Record<string, unknown> | undefined;
  passthrough: Record<string, unknown>;
  triggeredBy: string;
};

@Injectable()
export class SwarmRunApprovalsService {
  constructor(
    @InjectModel(SwarmRunApproval.name)
    private readonly approvalModel: Model<SwarmRunApprovalDocument>,
  ) {}

  async findById(id: string): Promise<SwarmRunApprovalDocument> {
    const doc = await this.approvalModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Swarm run approval not found');
    }
    return doc;
  }

  async findPendingForAssignee(userId: string, limit = 50): Promise<SwarmRunApprovalDocument[]> {
    return this.approvalModel
      .find({
        assigneeUserId: new Types.ObjectId(userId),
        status: SwarmRunApprovalStatus.PENDING,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async findPendingBySwarmRun(swarmRunId: string): Promise<SwarmRunApprovalDocument | null> {
    return this.approvalModel
      .findOne({
        swarmRunId: new Types.ObjectId(swarmRunId),
        status: SwarmRunApprovalStatus.PENDING,
      })
      .exec();
  }

  async createPending(params: CreateSwarmRunApprovalParams): Promise<SwarmRunApprovalDocument> {
    const data = parseUserApprovalNodeData(params.nodeData);
    const name = this.resolveApprovalName(data);
    const message = data.message?.trim() ?? '';
    const assigneeUserId = this.resolveAssigneeUserId(data, params.swarm, params.triggeredBy);

    return this.approvalModel.create({
      swarmRunId: params.swarmRunId,
      swarmId: params.swarm._id,
      nodeId: params.nodeId,
      name,
      message,
      passthrough: params.passthrough,
      assigneeUserId: new Types.ObjectId(assigneeUserId),
      requestedBy: new Types.ObjectId(params.triggeredBy),
      status: SwarmRunApprovalStatus.PENDING,
      decision: null,
      comment: '',
      decidedBy: null,
      decidedAt: null,
    });
  }

  async decide(
    userId: string,
    approvalId: string,
    decision: 'approve' | 'reject',
    comment = '',
  ): Promise<SwarmRunApprovalDocument> {
    const approval = await this.findById(approvalId);
    if (approval.assigneeUserId.toString() !== userId) {
      throw new ForbiddenException('You are not the assignee for this approval');
    }
    if (approval.status !== SwarmRunApprovalStatus.PENDING) {
      throw new BadRequestException('Approval has already been decided');
    }

    const status =
      decision === 'approve'
        ? SwarmRunApprovalStatus.APPROVED
        : SwarmRunApprovalStatus.REJECTED;

    const doc = await this.approvalModel
      .findByIdAndUpdate(
        approvalId,
        {
          status,
          decision,
          comment: comment.trim(),
          decidedBy: new Types.ObjectId(userId),
          decidedAt: new Date(),
        },
        { new: true },
      )
      .exec();

    if (!doc) {
      throw new NotFoundException('Swarm run approval not found');
    }
    return doc;
  }

  serialize(doc: SwarmRunApprovalDocument) {
    return serializeSwarmRunApproval(doc);
  }

  private resolveApprovalName(data: UserApprovalNodeData): string {
    const trimmed = data.name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : 'User approval';
  }

  private resolveAssigneeUserId(
    data: UserApprovalNodeData,
    swarm: SwarmDocument,
    triggeredBy: string,
  ): string {
    const assignee = data.assignee ?? 'runner';
    if (assignee === 'runner') {
      return triggeredBy;
    }
    if (assignee === 'owner') {
      return swarm.createdBy.toString();
    }
    if (Types.ObjectId.isValid(assignee)) {
      return assignee;
    }
    return triggeredBy;
  }
}
