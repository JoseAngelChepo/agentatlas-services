import type { UserProfile } from '../../users/utils/user-profile';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: UserProfile;
}
