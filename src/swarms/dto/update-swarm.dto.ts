import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSwarmDto } from './create-swarm.dto';

export class UpdateSwarmDto extends PartialType(CreateSwarmDto) {
  /** Admin-only: allow any authenticated user to run without hiring. */
  @IsOptional()
  @IsBoolean()
  platformRunnable?: boolean;
}
