import { IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class AgentWorkerModelDto {
  @IsString()
  @MinLength(1)
  provider: string;

  @IsString()
  @MinLength(1)
  name: string;

  /** Optional — not used at inference time. */
  @IsOptional()
  @IsInt()
  @Min(1)
  contextWindow?: number;

  /** e.g. temperature, maxTokens, jsonMode, model (override). */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
