import { SetMetadata } from '@nestjs/common';

export const ALLOW_USER_PAT_KEY = 'allowUserPat';

/**
 * Marks a handler as safe for per-user API tokens (PAT).
 * Routes without this decorator reject PAT with 403 when using JwtOrUserPatGuard + UserPatScopeGuard.
 */
export const AllowUserPat = () => SetMetadata(ALLOW_USER_PAT_KEY, true);
