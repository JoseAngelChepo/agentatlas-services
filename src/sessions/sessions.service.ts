import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument, SessionType } from './schemas/session.schema';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
  ) {}

  async create(
    userId: string,
    refreshToken: string,
    type: SessionType,
  ): Promise<SessionDocument> {
    const session = new this.sessionModel({
      userId: new Types.ObjectId(userId),
      refreshToken,
      type,
      lastUsed: new Date(),
    });
    return session.save();
  }

  async findByRefreshToken(refreshToken: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ refreshToken }).exec();
  }

  async updateRefreshToken(sessionId: string, newRefreshToken: string): Promise<void> {
    await this.sessionModel
      .findByIdAndUpdate(sessionId, {
        refreshToken: newRefreshToken,
        lastUsed: new Date(),
      })
      .exec();
  }

  async deleteByRefreshToken(refreshToken: string): Promise<void> {
    await this.sessionModel.deleteOne({ refreshToken }).exec();
  }

  async deleteAllByUserId(userId: string): Promise<void> {
    await this.sessionModel.deleteMany({ userId: new Types.ObjectId(userId) }).exec();
  }
}
