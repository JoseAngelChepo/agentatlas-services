import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UserApiToken, UserApiTokenSchema } from './schemas/user-api-token.schema';
import { UserApiTokensService } from './user-api-tokens.service';
import { UsersModule } from '../users/users.module';
import { JwtOrUserPatGuard } from '../common/guards/jwt-or-user-pat.guard';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MongooseModule.forFeature([{ name: UserApiToken.name, schema: UserApiTokenSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [UserApiTokensService, JwtOrUserPatGuard],
  exports: [UserApiTokensService, JwtOrUserPatGuard, JwtModule],
})
export class UserApiTokensModule {}
