import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SwarmsModule } from '../swarms/swarms.module';
import { ScraperModule } from '../scraper/scraper.module';
import { CloudflareBrowserRunService } from './providers/cloudflare-browser-run.service';
import { WebpageScrapeTool } from './implementations/webpage-scrape.tool';
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
    CloudflareBrowserRunService,
    ...registerAgentTool(WebpageScrapeTool),
    ToolRegistryService,
    UserToolConnectionsService,
    ToolsService,
  ],
  exports: [ToolsService, ToolRegistryService, UserToolConnectionsService, CloudflareBrowserRunService],
})
export class ToolsModule {}
