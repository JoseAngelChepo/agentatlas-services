import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExtractJwt } from 'passport-jwt';

/**
 * Optional session for public routes: sets `request.user` when a valid Bearer JWT is present;
 * otherwise leaves user unset (no 401). Pair with `@OptionalUser()` in handlers.
 * @see docs/GUARDS.md — “Optional auth”
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!token) {
      return true;
    }
    try {
      return (await super.canActivate(context)) as boolean;
    } catch {
      return true;
    }
  }

  override handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser | undefined {
    if (err || !user) {
      return undefined;
    }
    return user;
  }
}
