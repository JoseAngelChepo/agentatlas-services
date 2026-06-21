import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UserApprovalDecision } from '../types/user-approval-node.types';

export class DecideSwarmRunApprovalDto {
  @IsIn(['approve', 'reject'])
  decision: UserApprovalDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
