import { IsOptional, IsString, MinLength } from 'class-validator';

export class DuplicateSwarmDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
