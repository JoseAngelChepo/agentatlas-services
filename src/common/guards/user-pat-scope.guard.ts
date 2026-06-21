import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ALLOW_USER_PAT_KEY } from '../decorators/allow-user-pat.decorator';
import type { AuthMethod } from '../types/auth-method.type';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export type RequestWithAuthMethod = Request & {
  user?: JwtPayload;
  authMethod?: AuthMethod;
};

/**
 * Deny-by-default PAT scope: user API tokens may only hit handlers decorated with @AllowUserPat().
 * Pair with JwtOrUserPatGuard (session JWT is unrestricted on the same controller).
 */
@Injectable()
export class UserPatScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuthMethod>();

    if (request.authMethod !== 'user_pat') {
      return true;
    }

    const allowPat = this.reflector.getAllAndOverride<boolean>(ALLOW_USER_PAT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowPat) {
      throw new ForbiddenException(
        'This endpoint requires a browser session (JWT). User API tokens are limited to read and run automation routes — see docs/SWARMS-API.md.',
      );
    }

    return true;
  }
}
