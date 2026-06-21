import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../users/schemas/user.schema';
import { ScrapeRequestSource } from '../scraper/types/scrape-request-source.enum';
import { WebpageScrapeDto } from './dto/webpage-scrape.dto';
import { PLATFORM_TOOL_DEFINITIONS } from './platform-tool.registry';
import { UserToolConnectionsService } from './services/user-tool-connections.service';
import { ToolsService } from './tools.service';
import { ToolId } from './types/tool-id.enum';
import { ToolConnectionStatus } from './types/platform-tool.types';

@Controller('tools')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
export class ToolsController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly userToolConnections: UserToolConnectionsService,
  ) {}

  /** Registered agent-callable tools (e.g. webpage_scrape). */
  @Get()
  listTools() {
    return {
      tools: this.toolsService.listTools(),
    };
  }

  /** Platform integration catalog for `{{runInput.toolsAvailables}}` editor preview. */
  @Get('catalog')
  async catalog(@CurrentUser() user: JwtPayload) {
    return this.toolsService.buildPlatformToolsCatalog(user.sub, user.role);
  }

  /** Static platform tool definitions + per-user connection status. */
  @Get('integrations')
  async listIntegrations(@CurrentUser() user: JwtPayload) {
    const connectedKeys = await this.userToolConnections.listConnectedKeys(user.sub);

    return {
      tools: PLATFORM_TOOL_DEFINITIONS.map((definition) => ({
        key: definition.key,
        id: definition.catalogId,
        name: definition.name,
        covers: definition.covers,
        status: connectedKeys.has(definition.key)
          ? ToolConnectionStatus.CONNECTED
          : ToolConnectionStatus.MISSING,
      })),
    };
  }

  @Post('integrations/:platformToolKey/connect')
  async connectIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('platformToolKey') platformToolKey: string,
    @Body() body: { metadata?: Record<string, unknown> },
  ) {
    const doc = await this.userToolConnections.connect(
      user.sub,
      platformToolKey,
      body?.metadata,
    );
    return {
      key: doc.platformToolKey,
      connectedAt: doc.connectedAt.toISOString(),
      metadata: doc.metadata,
    };
  }

  @Delete('integrations/:platformToolKey/connect')
  async disconnectIntegration(
    @CurrentUser() user: JwtPayload,
    @Param('platformToolKey') platformToolKey: string,
  ) {
    await this.userToolConnections.disconnect(user.sub, platformToolKey);
    return { disconnected: true };
  }

  @Post('webpage-scrape/run')
  runWebpageScrape(@CurrentUser() user: JwtPayload, @Body() dto: WebpageScrapeDto) {
    return this.toolsService.runWebpageScrape(dto, {
      userId: user.sub,
      source: ScrapeRequestSource.API,
    });
  }

  @Post(':id/run')
  runTool(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: ToolId,
    @Body() input: Record<string, unknown>,
  ) {
    return this.toolsService.runTool(id, input, { userId: user.sub });
  }
}
