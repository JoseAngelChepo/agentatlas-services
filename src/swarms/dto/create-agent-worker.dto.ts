import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ToolId } from '../../tools/types/tool-id.enum';
import { AgentWorkerModelDto } from './agent-worker-model.dto';
import { AgentWorkerPromptMessageDto } from './agent-worker-prompt-message.dto';

export class CreateAgentWorkerDto {
  @IsString()
  @MinLength(1)
  name: string;

  @ValidateNested()
  @Type(() => AgentWorkerModelDto)
  model: AgentWorkerModelDto;

  @IsString()
  @MinLength(1)
  systemPrompt: string;

  /** Custom prompt assembly — see docs/SWARMS-AGENT-IO.md#custom-prompt-messages-promptmessages */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentWorkerPromptMessageDto)
  promptMessages?: AgentWorkerPromptMessageDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  upstreamFields?: string[];

  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  outputSchema?: Record<string, unknown>;

  /** OpenAI-only: `{ webSearch: true, toolChoice: "auto", functions: [...] }` */
  @IsOptional()
  @IsObject()
  openaiTools?: Record<string, unknown>;

  /** Grok-only: `{ xSearch: true, toolChoice: "auto", xSearchAllowedHandles: [...] }` */
  @IsOptional()
  @IsObject()
  grokTools?: Record<string, unknown>;

  /** Platform tools available to this worker via function calling. */
  @IsOptional()
  @IsArray()
  @IsEnum(ToolId, { each: true })
  agentTools?: ToolId[];

  /** Child swarms exposed as `swarm_<objectId>` function tools during inference. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  swarmTools?: string[];

  @IsOptional()
  @IsBoolean()
  compressOutput?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutMs?: number;
}
