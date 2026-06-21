import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isPlatformToolKey } from '../platform-tool.registry';
import {
  UserToolConnection,
  UserToolConnectionDocument,
} from '../schemas/user-tool-connection.schema';
import { PlatformToolKey } from '../types/platform-tool.types';

@Injectable()
export class UserToolConnectionsService {
  constructor(
    @InjectModel(UserToolConnection.name)
    private readonly connectionModel: Model<UserToolConnectionDocument>,
  ) {}

  async listConnectedKeys(userId: string): Promise<Set<PlatformToolKey>> {
    const docs = await this.connectionModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('platformToolKey')
      .lean()
      .exec();

    return new Set(docs.map((doc) => doc.platformToolKey));
  }

  async listForUser(userId: string): Promise<UserToolConnectionDocument[]> {
    return this.connectionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ connectedAt: -1 })
      .exec();
  }

  async connect(
    userId: string,
    platformToolKey: string,
    metadata?: Record<string, unknown>,
  ): Promise<UserToolConnectionDocument> {
    if (!isPlatformToolKey(platformToolKey)) {
      throw new BadRequestException(`Unknown platform tool key: ${platformToolKey}`);
    }

    return this.connectionModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          platformToolKey,
        },
        {
          $set: {
            connectedAt: new Date(),
            ...(metadata !== undefined ? { metadata } : {}),
          },
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            platformToolKey,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async disconnect(userId: string, platformToolKey: string): Promise<void> {
    if (!isPlatformToolKey(platformToolKey)) {
      throw new BadRequestException(`Unknown platform tool key: ${platformToolKey}`);
    }

    const result = await this.connectionModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        platformToolKey,
      })
      .exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException(`Tool connection not found: ${platformToolKey}`);
    }
  }
}
