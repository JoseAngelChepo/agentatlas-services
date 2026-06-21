import { IsArray, IsBoolean, IsEnum, IsMongoId, IsOptional, IsString, MinLength } from 'class-validator';
import { SwarmTopology } from '../types/swarm-topology.enum';

export class CreateSwarmDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(1)
  goal: string;

  @IsOptional()
  @IsEnum(SwarmTopology)
  topology?: SwarmTopology;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  workers?: string[];

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Routing tags (`contact_lookup`, `send_message`, …). Lowercase snake_case. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggers?: string[];
}
