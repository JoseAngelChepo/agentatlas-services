import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SwarmsModule } from '../swarms/swarms.module';
import { ScraperModule } from '../scraper/scraper.module';
import { FirecrawlService } from './providers/firecrawl.service';
import { ResearchService } from '../research/research.service';
import { WebpageScrapeTool } from './implementations/webpage-scrape.tool';
import { WebSearchTool } from './implementations/web-search.tool';
import { ResearchSearchPapersTool } from './implementations/research-search-papers.tool';
import { ResearchPaperTool } from './implementations/research-paper.tool';
import { ResearchRelatedPapersTool } from './implementations/research-related-papers.tool';
import { ResearchSearchGithubTool } from './implementations/research-search-github.tool';
import { registerAgentTool } from './registry/agent-tools.token';
import { ToolRegistryService } from './registry/tool-registry.service';
import {
  UserToolConnection,
  UserToolConnectionSchema,
} from './schemas/user-tool-connection.schema';
import { UserToolConnectionsService } from './services/user-tool-connections.service';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  imports: [
    forwardRef(() => ScraperModule),
    forwardRef(() => SwarmsModule),
    MongooseModule.forFeature([
      { name: UserToolConnection.name, schema: UserToolConnectionSchema },
    ]),
  ],
  controllers: [ToolsController],
  providers: [
    FirecrawlService,
    ResearchService,
    ...registerAgentTool(WebpageScrapeTool),
    ...registerAgentTool(WebSearchTool),
    ...registerAgentTool(ResearchSearchPapersTool),
    ...registerAgentTool(ResearchPaperTool),
    ...registerAgentTool(ResearchRelatedPapersTool),
    ...registerAgentTool(ResearchSearchGithubTool),
    ToolRegistryService,
    UserToolConnectionsService,
    ToolsService,
  ],
  exports: [ToolsService, ToolRegistryService, UserToolConnectionsService, FirecrawlService, ResearchService],
})
export class ToolsModule {}
