import { ForbiddenException, Injectable } from '@nestjs/common';
import { SwarmDocument } from '../schemas/swarm.schema';
import { SwarmsService } from './swarms.service';

@Injectable()
export class SwarmAccessService {
  constructor(private readonly swarmsService: SwarmsService) {}

  isOwner(userId: string, swarm: SwarmDocument): boolean {
    return swarm.createdBy.toString() === userId;
  }

  async assertCanRun(userId: string, swarmId: string): Promise<SwarmDocument> {
    const swarm = await this.swarmsService.findById(swarmId);
    if (swarm.active === false) {
      throw new ForbiddenException('This swarm is inactive and cannot be run');
    }

    if (this.isOwner(userId, swarm)) {
      return swarm;
    }

    if (swarm.platformRunnable === true) {
      return swarm;
    }

    throw new ForbiddenException('You do not have access to run this swarm');
  }

  async canRun(userId: string, swarmId: string): Promise<boolean> {
    try {
      await this.assertCanRun(userId, swarmId);
      return true;
    } catch {
      return false;
    }
  }

  async assertCanManage(userId: string, swarmId: string): Promise<SwarmDocument> {
    return this.swarmsService.findByIdForUser(userId, swarmId);
  }
}
