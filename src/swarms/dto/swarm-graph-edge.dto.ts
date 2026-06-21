import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GraphEdgeType } from '../types/graph-edge-type.enum';

export class SwarmGraphEdgeDto {
  @IsString()
  from: string;

  @IsString()
  to: string;

  @IsOptional()
  @IsEnum(GraphEdgeType)
  type?: GraphEdgeType;

  @IsOptional()
  @IsString()
  condition?: string | null;

  @IsOptional()
  @IsString()
  sourceHandle?: string | null;
}
