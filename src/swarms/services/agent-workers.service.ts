import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { assertSwarmOwner } from '../utils/assert-swarm-owner';
import { AgentWorker, AgentWorkerDocument } from '../schemas/agent-worker.schema';
import type { AdminListAgentWorkersQueryDto } from '../dto/admin-list-agent-workers-query.dto';
import type { CreateAgentWorkerDto } from '../dto/create-agent-worker.dto';
import type { UpdateAgentWorkerDto } from '../dto/update-agent-worker.dto';

export type AdminAgentWorkerListResult = {
  items: AgentWorkerDocument[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class AgentWorkersService {
  constructor(
    @InjectModel(AgentWorker.name)
    private readonly agentWorkerModel: Model<AgentWorkerDocument>,
  ) {}

  async findById(id: string | Types.ObjectId): Promise<AgentWorkerDocument> {
    const doc = await this.agentWorkerModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Agent worker not found');
    }
    return doc;
  }

  async findByIdForUser(userId: string, id: string): Promise<AgentWorkerDocument> {
    const doc = await this.findById(id);
    assertSwarmOwner(userId, doc.createdBy);
    return doc;
  }

  async findAllForUser(userId: string): Promise<AgentWorkerDocument[]> {
    return this.agentWorkerModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByIds(ids: Types.ObjectId[]): Promise<Map<string, AgentWorkerDocument>> {
    const docs = await this.agentWorkerModel.find({ _id: { $in: ids } }).exec();
    return new Map(docs.map((d) => [d._id.toString(), d]));
  }

  async create(userId: string, dto: CreateAgentWorkerDto): Promise<AgentWorkerDocument> {
    return this.agentWorkerModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAgentWorkerDto,
  ): Promise<AgentWorkerDocument> {
    await this.findByIdForUser(userId, id);
    const doc = await this.agentWorkerModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
      .exec();
    if (!doc) {
      throw new NotFoundException('Agent worker not found');
    }
    return doc;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findByIdForUser(userId, id);
    await this.agentWorkerModel.findByIdAndDelete(id).exec();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async adminFindMany(query: AdminListAgentWorkersQueryDto): Promise<AdminAgentWorkerListResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const filter: FilterQuery<AgentWorkerDocument> = {};
    if (query.userId) {
      filter.createdBy = new Types.ObjectId(query.userId);
    }
    if (search.length > 0) {
      const rx = new RegExp(this.escapeRegex(search), 'i');
      filter.name = rx;
    }

    const [items, total] = await Promise.all([
      this.agentWorkerModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.agentWorkerModel.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  async adminFindOne(id: string): Promise<AgentWorkerDocument> {
    return this.findById(id);
  }

  async adminUpdate(id: string, dto: UpdateAgentWorkerDto): Promise<AgentWorkerDocument> {
    const defined =
      dto.name !== undefined ||
      dto.model !== undefined ||
      dto.systemPrompt !== undefined ||
      dto.promptMessages !== undefined ||
      dto.upstreamFields !== undefined ||
      dto.inputSchema !== undefined ||
      dto.outputSchema !== undefined ||
      dto.openaiTools !== undefined ||
      dto.grokTools !== undefined ||
      dto.agentTools !== undefined ||
      dto.swarmTools !== undefined ||
      dto.compressOutput !== undefined ||
      dto.maxRetries !== undefined ||
      dto.timeoutMs !== undefined;
    if (!defined) {
      throw new BadRequestException('No supported fields to update');
    }

    await this.findById(id);
    const doc = await this.agentWorkerModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
      .exec();
    if (!doc) {
      throw new NotFoundException('Agent worker not found');
    }
    return doc;
  }

  async adminRemove(id: string): Promise<void> {
    await this.findById(id);
    await this.agentWorkerModel.findByIdAndDelete(id).exec();
  }
}
