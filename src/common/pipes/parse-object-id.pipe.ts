import { BadRequestException, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/** Validates MongoDB ObjectId strings from route params. */
export class ParseObjectIdPipe implements PipeTransform<string, Types.ObjectId> {
  transform(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException('Invalid id');
    }
    return new Types.ObjectId(value);
  }
}
