import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { CreateAgentWorkerDto } from './create-agent-worker.dto';
import { AgentWorkerModelDto } from './agent-worker-model.dto';

export class UpdateAgentWorkerDto extends PartialType(
  OmitType(CreateAgentWorkerDto, ['model'] as const),
) {
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentWorkerModelDto)
  model?: AgentWorkerModelDto;
}
