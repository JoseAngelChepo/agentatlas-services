import { IsIn, IsOptional, IsUrl } from 'class-validator';

export class WebpageScrapeDto {
  @IsUrl({ require_protocol: true })
  url: string;

  @IsOptional()
  @IsIn(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
}
