import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { SwarmAsToolService } from '../swarms/services/swarm-as-tool.service';
import type { UserRole } from '../users/schemas/user.schema';
import type { ScrapeWebpageContext } from '../scraper/types/scrape-webpage.types';
import type { ToolCatalogEntry } from './types/agent-tool.interface';
import { ToolId } from './types/tool-id.enum';
import type { ToolExecutionContext } from './types/tool-execution-context';
import type { RunSwarmToolInput } from './types/run-swarm.types';
import type { WebpageScrapeInput, WebpageScrapeOutput } from './types/webpage-scrape.types';
import { ToolRegistryService } from './registry/tool-registry.service';
import { UserToolConnectionsService } from './services/user-tool-connections.service';
import {
  buildPlatformToolDescriptors,
  formatToolsAvailablesText,
} from './utils/build-platform-tool-descriptors';
import type { PlatformToolDescriptor } from './types/platform-tool.types';

@Injectable()
export class ToolsService {
  constructor(
    private readonly registry: ToolRegistryService,
    @Inject(forwardRef(() => SwarmAsToolService))
    private readonly swarmAsToolService: SwarmAsToolService,
    private readonly userToolConnections: UserToolConnectionsService,
  ) {}

  listTools(): ToolCatalogEntry[] {
    return [...this.registry.list(), this.swarmAsToolService.runSwarmCatalogEntry()];
  }

  /** Platform integration catalog for `runInput.toolsAvailable` and editor preview. */
  async buildPlatformToolsCatalog(
    userId: string,
    role?: UserRole,
  ): Promise<{ toolsAvailable: PlatformToolDescriptor[]; toolsAvailables: string }> {
    void role;
    void userId;
    const connectedKeys = await this.userToolConnections.listConnectedKeys(userId);
    const toolsAvailable = buildPlatformToolDescriptors(connectedKeys);

    return {
      toolsAvailable,
      toolsAvailables: formatToolsAvailablesText(toolsAvailable),
    };
  }

  async runWebpageScrape(
    input: WebpageScrapeInput,
    context: ScrapeWebpageContext,
  ): Promise<WebpageScrapeOutput> {
    const tool = this.registry.get(ToolId.WEBPAGE_SCRAPE);
    return tool.execute(input, {
      userId: context.userId,
      swarmRunId: context.swarmRunId,
      agentRunId: context.agentRunId,
    }) as Promise<WebpageScrapeOutput>;
  }

  async runTool(
    id: ToolId,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    if (id === ToolId.RUN_SWARM) {
      return this.swarmAsToolService.runSwarmTool(input as RunSwarmToolInput, context);
    }

    const tool = this.registry.get(id);
    return tool.execute(input, context);
  }
}
