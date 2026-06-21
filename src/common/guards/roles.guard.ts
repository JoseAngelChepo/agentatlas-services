import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/schemas/user.schema';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{
      user?: { role?: UserRole | string };
    }>();
    const role = user?.role;

    if (role == null || role === '') {
      throw new ForbiddenException('Insufficient permissions');
    }

    const allowed = new Set(requiredRoles);
    if (allowed.has(UserRole.USER)) {
      allowed.add(UserRole.ADMIN);
    }

    const ok = [...allowed].some((r) => String(role) === r);
    if (!ok) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
