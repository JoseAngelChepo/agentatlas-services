import type { UserDocument } from '../schemas/user.schema';

export type UserProfile = {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  avatar?: string;
  accountTier: string;
  canCreateSwarms: boolean;
};

export function buildUserProfile(user: UserDocument): UserProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username ?? '',
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    avatar: user.avatar,
    accountTier: user.accountTier,
    canCreateSwarms: user.canCreateSwarms ?? false,
  };
}
