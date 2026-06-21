import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

export function assertSwarmOwner(userId: string, createdBy: Types.ObjectId): void {
  if (createdBy.toString() !== userId) {
    throw new ForbiddenException('You do not have access to this resource');
  }
}
