import { Injectable } from '@nestjs/common';
import { ToolsService } from '../../tools/tools.service';
import type { ContextAccessActor } from './swarm-run-input-enrichment.types';

/**
 * Merges platform tool catalog into swarm run `input` when not supplied by the caller.
 * Powers `{{runInput.toolsAvailables}}` and related editor tokens for test runs.
 */
@Injectable()
export class SwarmRunInputEnrichmentService {
  constructor(private readonly toolsService: ToolsService) {}

  async enrich(
    actor: ContextAccessActor,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if ('toolsAvailables' in input || 'toolsAvailable' in input) {
      return input;
    }

    const catalog = await this.toolsService.buildPlatformToolsCatalog(
      actor.userId,
      actor.role,
    );

    return {
      ...input,
      toolsAvailable: catalog.toolsAvailable,
      toolsAvailables: catalog.toolsAvailables,
    };
  }
}
