import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUserApiTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
