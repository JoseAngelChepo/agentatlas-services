import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SwarmGraph, SwarmGraphDocument } from '../schemas/swarm-graph.schema';
import { SwarmAccessService } from './swarm-access.service';
import { SwarmsService } from './swarms.service';
import type { UpsertSwarmGraphDto } from '../dto/upsert-swarm-graph.dto';
import { GraphEdgeType } from '../types/graph-edge-type.enum';
import { dedupeSwarmGraphEdges } from '../utils/dedupe-swarm-graph-edges';
import {
  validateGraphNodeIds,
  validateSwarmGraphReferences,
} from '../utils/validate-swarm-graph-references';

@Injectable()
export class SwarmGraphsService {
  constructor(
    @InjectModel(SwarmGraph.name)
    private readonly swarmGraphModel: Model<SwarmGraphDocument>,
    private readonly swarmsService: SwarmsService,
    private readonly swarmAccessService: SwarmAccessService,
  ) {}

  async findBySwarmId(swarmId: string): Promise<SwarmGraphDocument> {
    const doc = await this.swarmGraphModel.findOne({ swarmId }).exec();
    if (!doc) {
      throw new NotFoundException('Swarm graph not found');
    }
    return doc;
  }

  async findBySwarmIdOptional(swarmId: string): Promise<SwarmGraphDocument | null> {
    return this.swarmGraphModel.findOne({ swarmId: new Types.ObjectId(swarmId) }).exec();
  }

  async findManyBySwarmIds(swarmIds: string[]): Promise<Map<string, SwarmGraphDocument>> {
    if (swarmIds.length === 0) {
      return new Map();
    }
    const objectIds = swarmIds.map((id) => new Types.ObjectId(id));
    const docs = await this.swarmGraphModel.find({ swarmId: { $in: objectIds } }).exec();
    return new Map(docs.map((doc) => [doc.swarmId.toString(), doc]));
  }

  async findBySwarmIdForUser(userId: string, swarmId: string): Promise<SwarmGraphDocument> {
    await this.swarmsService.findByIdForUser(userId, swarmId);
    return this.findBySwarmId(swarmId);
  }

  async upsertForUser(
    userId: string,
    swarmId: string,
    dto: UpsertSwarmGraphDto,
  ): Promise<SwarmGraphDocument> {
    await this.swarmsService.findByIdForUser(userId, swarmId);
    return this.upsert(swarmId, dto, userId);
  }

  async adminFindBySwarmId(swarmId: string): Promise<SwarmGraphDocument> {
    await this.swarmsService.findById(swarmId);
    return this.findBySwarmId(swarmId);
  }

  async adminUpsert(
    swarmId: string,
    dto: UpsertSwarmGraphDto,
    adminUserId: string,
  ): Promise<SwarmGraphDocument> {
    await this.swarmsService.findById(swarmId);
    return this.upsert(swarmId, dto, adminUserId);
  }

  private async upsert(
    swarmId: string,
    dto: UpsertSwarmGraphDto,
    userId?: string,
  ): Promise<SwarmGraphDocument> {
    validateGraphNodeIds(dto);
    if (userId) {
      await validateSwarmGraphReferences({
        rootSwarmId: swarmId,
        dto,
        userId,
        loadGraph: async (id) => {
          const doc = await this.findBySwarmIdOptional(id);
          return doc ? doc.toObject() : null;
        },
        loadSwarm: (id) => this.swarmsService.findById(id),
        assertCanRun: (uid, id) => this.swarmAccessService.assertCanRun(uid, id),
      });
    }

    const swarmObjectId = new Types.ObjectId(swarmId);

    const payload = {
      swarmId: swarmObjectId,
      nodes: dto.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        workerId: n.workerId ? new Types.ObjectId(n.workerId) : undefined,
        type: n.type,
        position: {
          x: n.position?.x ?? 0,
          y: n.position?.y ?? 0,
        },
        data: n.data,
      })),
      edges: dedupeSwarmGraphEdges(
        dto.edges.map((e) => ({
          from: e.from,
          to: e.to,
          type: e.type ?? GraphEdgeType.SEQUENTIAL,
          condition: e.condition ?? null,
          sourceHandle: e.sourceHandle ?? null,
        })),
      ),
      entryNode: dto.entryNode,
      exitNode: dto.exitNode,
    };

    const doc = await this.swarmGraphModel
      .findOneAndUpdate({ swarmId: swarmObjectId }, payload, {
        new: true,
        upsert: true,
      })
      .exec();

    if (!doc) {
      throw new NotFoundException('Swarm graph not found');
    }
    return doc;
  }
}
