import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UserApiTokensService } from '../../user-api-tokens/user-api-tokens.service';
import { AccountTier } from '../../users/schemas/user.schema';
import type { AuthMethod } from '../types/auth-method.type';
import type { RequestWithAuthMethod } from './user-pat-scope.guard';

/**
 * Accepts either a normal user JWT (`Authorization: Bearer <jwt>`)
 * or a per-user API token (`Authorization: Bearer {AGENT_KEY_PREFIX}<mongoId>_<secret>`).
 * @see docs/GUARDS.md — “JWT or PAT”
 */
@Injectable()
export class JwtOrUserPatGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userApiTokensService: UserApiTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuthMethod>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    if (token.split('.').length === 3) {
      try {
        const secret = this.configService.getOrThrow<string>('JWT_SECRET');
        const payload = this.jwtService.verify<JwtPayload>(token, { secret });
        if (payload?.sub && payload.email) {
          request.user = {
            sub: payload.sub,
            email: payload.email,
            role: payload.role,
            accountTier: payload.accountTier ?? AccountTier.FREE,
          };
          request.authMethod = 'jwt';
          return true;
        }
      } catch {
        // fall through to PAT
      }
    }

    const patUser = await this.userApiTokensService.validateRawToken(token);
    if (patUser) {
      request.user = patUser;
      request.authMethod = 'user_pat';
      return true;
    }

    throw new UnauthorizedException('Invalid or expired token');
  }
}
