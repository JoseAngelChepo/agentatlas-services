import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ToolsModule } from '../tools/tools.module';
import { ScrapeRequest, ScrapeRequestSchema } from './schemas/scrape-request.schema';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ScrapeRequest.name, schema: ScrapeRequestSchema }]),
    forwardRef(() => ToolsModule),
  ],
  controllers: [ScraperController],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}
