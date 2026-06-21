import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/schemas/user.schema';

export const ROLES_KEY = 'roles';

/** Require one of these roles (after guard expansion: USER also allows ADMIN). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
