import { BadRequestException } from '@nestjs/common';
import type { ToolExecutionContext } from '../types/tool-execution-context';

export function requireToolUserId(
  toolId: string,
  context?: ToolExecutionContext,
): string {
  const userId = context?.userId?.trim();
  if (!userId) {
    throw new BadRequestException(`${toolId} requires an authenticated user context`);
  }
  return userId;
}
