import { IsEnum, IsString, MinLength } from 'class-validator';

export enum AgentWorkerPromptMessageRole {
  SYSTEM = 'system',
  USER = 'user',
}

export class AgentWorkerPromptMessageDto {
  @IsEnum(AgentWorkerPromptMessageRole)
  role: AgentWorkerPromptMessageRole;

  @IsString()
  @MinLength(1)
  content: string;
}
