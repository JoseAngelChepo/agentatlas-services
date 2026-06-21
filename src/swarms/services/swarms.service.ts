import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { UsersService } from '../../users/users.service';
import { assertSwarmOwner } from '../utils/assert-swarm-owner';
import { normalizeSwarmTriggers } from '../utils/normalize-swarm-triggers';
import { Swarm, SwarmDocument } from '../schemas/swarm.schema';
import type { AdminListSwarmsQueryDto } from '../dto/admin-list-swarms-query.dto';
import type { CreateSwarmDto } from '../dto/create-swarm.dto';
import type { UpdateSwarmDto } from '../dto/update-swarm.dto';

export type AdminSwarmListResult = {
  items: SwarmDocument[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class SwarmsService {
  constructor(
    @InjectModel(Swarm.name)
    private readonly swarmModel: Model<SwarmDocument>,
    private readonly usersService: UsersService,
  ) {}

  async findById(id: string): Promise<SwarmDocument> {
    const doc = await this.swarmModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Swarm not found');
    }
    return doc;
  }

  async findByIds(ids: string[]): Promise<Map<string, SwarmDocument>> {
    if (ids.length === 0) {
      return new Map();
    }

    const unique = [...new Set(ids)];
    const docs = await this.swarmModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .exec();

    return new Map(docs.map((doc) => [doc.id, doc]));
  }

  async findByIdForUser(userId: string, id: string): Promise<SwarmDocument> {
    const doc = await this.findById(id);
    assertSwarmOwner(userId, doc.createdBy);
    return doc;
  }

  async findAllForUser(userId: string): Promise<SwarmDocument[]> {
    return this.swarmModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async create(userId: string, dto: CreateSwarmDto): Promise<SwarmDocument> {
    await this.usersService.assertCanCreateSwarms(userId);
    return this.swarmModel.create({
      name: dto.name,
      description: dto.description ?? '',
      goal: dto.goal,
      topology: dto.topology,
      workers: (dto.workers ?? []).map((id) => new Types.ObjectId(id)),
      version: dto.version,
      isPublic: dto.isPublic,
      active: dto.active ?? true,
      triggers: normalizeSwarmTriggers(dto.triggers),
      createdBy: new Types.ObjectId(userId),
    });
  }

  async update(userId: string, id: string, dto: UpdateSwarmDto): Promise<SwarmDocument> {
    await this.findByIdForUser(userId, id);
    const { platformRunnable: _platformRunnable, ...rest } = dto;
    const update: Record<string, unknown> = { ...rest };
    if (dto.workers) {
      update.workers = dto.workers.map((workerId) => new Types.ObjectId(workerId));
    }
    if (dto.triggers !== undefined) {
      update.triggers = normalizeSwarmTriggers(dto.triggers);
    }
    const doc = await this.swarmModel.findByIdAndUpdate(id, update, { new: true }).exec();
    if (!doc) {
      throw new NotFoundException('Swarm not found');
    }
    return doc;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findByIdForUser(userId, id);
    await this.swarmModel.findByIdAndDelete(id).exec();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async adminFindMany(query: AdminListSwarmsQueryDto): Promise<AdminSwarmListResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const filter: FilterQuery<SwarmDocument> = {};
    if (query.userId) {
      filter.createdBy = new Types.ObjectId(query.userId);
    }
    if (search.length > 0) {
      const rx = new RegExp(this.escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { description: rx }, { goal: rx }];
    }

    const [items, total] = await Promise.all([
      this.swarmModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.swarmModel.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  async adminFindOne(id: string): Promise<SwarmDocument> {
    return this.findById(id);
  }

  async adminUpdate(id: string, dto: UpdateSwarmDto): Promise<SwarmDocument> {
    const defined =
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.goal !== undefined ||
      dto.topology !== undefined ||
      dto.workers !== undefined ||
      dto.version !== undefined ||
      dto.isPublic !== undefined ||
      dto.platformRunnable !== undefined ||
      dto.active !== undefined;
    if (!defined) {
      throw new BadRequestException('No supported fields to update');
    }

    await this.findById(id);
    const update: Record<string, unknown> = { ...dto };
    if (dto.workers) {
      update.workers = dto.workers.map((workerId) => new Types.ObjectId(workerId));
    }
    const doc = await this.swarmModel.findByIdAndUpdate(id, update, { new: true }).exec();
    if (!doc) {
      throw new NotFoundException('Swarm not found');
    }
    return doc;
  }

  async adminRemove(id: string): Promise<void> {
    await this.findById(id);
    await this.swarmModel.findByIdAndDelete(id).exec();
  }
}
