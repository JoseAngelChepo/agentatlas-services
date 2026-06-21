import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UsernameAvailabilityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;
}
