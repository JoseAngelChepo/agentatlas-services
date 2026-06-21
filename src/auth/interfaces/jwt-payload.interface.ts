import { UserRole, AccountTier } from '../../users/schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  accountTier: AccountTier;
  iat?: number;
  exp?: number;
}
