import { IsArray, IsMongoId, IsObject, IsOptional } from 'class-validator';

/**
 * Test one AgentWorker in isolation (workspace node inspector).
 * Requires `swarmId` for goal context and run persistence.
 */
export class RunAgentWorkerDto {
  @IsMongoId()
  swarmId: string;

  /** Initial payload → `SwarmContext.runInput` (any object shape; `message` is optional). */
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;

  /**
   * Simulated upstream outputs (same shape as graph predecessors).
   * Omit for empty upstream; use when previewing mid-pipeline behavior.
   */
  @IsOptional()
  @IsArray()
  upstream?: Record<string, unknown>[];
}
