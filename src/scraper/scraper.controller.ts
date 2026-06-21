import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../users/schemas/user.schema';
import { ListScrapeRequestsQueryDto } from './dto/list-scrape-requests-query.dto';
import { ScraperService } from './scraper.service';
import { serializeScrapeRequest } from './utils/scrape-request-serializers';

@Controller('scraper')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Get('requests')
  async listRequests(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListScrapeRequestsQueryDto,
  ) {
    const result = await this.scraperService.findAllForUser(user.sub, query);
    return {
      items: result.items.map(serializeScrapeRequest),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Get('requests/:id')
  async getRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const doc = await this.scraperService.findByIdForUser(user.sub, id);
    return serializeScrapeRequest(doc);
  }
}
