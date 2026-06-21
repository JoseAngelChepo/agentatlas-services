import type { UserRole } from '../../users/schemas/user.schema';

export type ContextAccessActor = {
  userId: string;
  role?: UserRole;
};
