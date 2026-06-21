import { Type } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { WorkerNodeType } from '../types/worker-node-type.enum';

export class SwarmGraphNodePositionDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

export class SwarmGraphNodeDto {
  /** Frontend-stable React Flow node id (e.g. `agent-1717014` ). Optional on writes. */
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsEnum(GraphNodeKind)
  kind?: GraphNodeKind;

  @IsOptional()
  @IsMongoId()
  workerId?: string;

  @IsOptional()
  @IsEnum(WorkerNodeType)
  type?: WorkerNodeType;

  @IsOptional()
  @ValidateNested()
  @Type(() => SwarmGraphNodePositionDto)
  position?: SwarmGraphNodePositionDto;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
