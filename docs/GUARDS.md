# Auth guards & decorators

This template ships reusable NestJS guards for three access patterns: **required JWT**, **optional JWT** (public routes that can personalize when logged in), and **JWT or PAT** (automation). Role checks layer on top via **`RolesGuard`** + **`@Roles()`**.

Pair with **template-platform** public routes (`/`, `/sign-in`, `/sign-up`) — see that repo’s `AuthGuard` and `src/proxy.ts` for the frontend side.

## Guard map

| Guard / decorator | Location | When to use |
|-------------------|----------|-------------|
| **`JwtAuthGuard`** | `src/auth/guards/jwt-auth.guard.ts` | Route requires a valid session; no token or invalid token → **401**. |
| **`OptionalJwtAuthGuard`** | `src/auth/guards/optional-jwt-auth.guard.ts` | Public route; attach `request.user` when a valid Bearer JWT is present. |
| **`@OptionalUser()`** | `src/common/decorators/optional-user.decorator.ts` | Read `request.user` in handlers protected by `OptionalJwtAuthGuard`. |
| **`JwtOrUserPatGuard`** | `src/common/guards/jwt-or-user-pat.guard.ts` | Script/agent endpoints: accept user JWT **or** PAT (`AGENT_KEY_PREFIX` + id + secret). |
| **`RolesGuard`** + **`@Roles()`** | `src/common/guards/roles.guard.ts`, `src/common/decorators/roles.decorator.ts` | After auth, restrict by `user` / `admin` role. Deep dive: [`role-guard-implementation.md`](./role-guard-implementation.md). |

## Rules of thumb

| Pattern | Guards | Typical routes |
|---------|--------|----------------|
| **Public, no identity** | *(none)* | Register, login, forgot-password, username availability |
| **Public, optional identity** | `OptionalJwtAuthGuard` | Marketing feeds, shared links, “show extra if logged in” |
| **Authenticated user** | `JwtAuthGuard`, `RolesGuard`, `@Roles(UserRole.USER)` | `/auth/me`, logout, PAT management |
| **Admin only** | `JwtAuthGuard`, `RolesGuard`, `@Roles(UserRole.ADMIN)` | `GET/PATCH /users/:id`, `/admin/swarms`, `/admin/agent-workers` |
| **Automation (JWT or PAT)** | `JwtOrUserPatGuard`, `UserPatScopeGuard`, `RolesGuard` | Swarms read/run, `/external/processes/*` — PAT only on `@AllowUserPat()` routes |

## 1. Required auth — `JwtAuthGuard`

Standard Passport JWT guard. **`JwtStrategy`** reloads the user from MongoDB and sets `request.user` to `{ sub, email, role, accountTier }`.

```typescript
@Get('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
getMe(@Req() req: RequestWithUser) {
  return this.authService.getMe(req.user.sub);
}
```

Guard order: **JWT first**, then **roles** when both apply.

## 2. Optional auth — public routes with session

Use when a route is **reachable without login**, but should behave differently (or return extra fields) when the caller sends a valid access token.

### Behavior

| Request | Result |
|---------|--------|
| No `Authorization` header | **200** — handler runs; `request.user` is `undefined` |
| Valid Bearer JWT | **200** — `request.user` populated like `JwtAuthGuard` |
| Invalid / expired JWT | **200** — handler runs; `request.user` is `undefined` (no 401) |

Invalid tokens are treated as anonymous so public pages and crawlers are not blocked by stale cookies.

### Controller example

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { OptionalUser } from '../common/decorators/optional-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('posts')
export class PostsController {
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@OptionalUser() user?: JwtPayload) {
    if (user) {
      return this.postsService.listForUser(user.sub);
    }
    return this.postsService.listPublic();
  }
}
```

### Adding optional-auth routes (checklist)

1. Create the handler with **`@UseGuards(OptionalJwtAuthGuard)`** (no `JwtAuthGuard` on the same route).
2. Inject identity with **`@OptionalUser()`**, not `@Req() req.user` — keeps handlers explicit.
3. Do **not** add `@Roles()` unless you also require auth for some actions on the same controller; split public vs protected handlers instead.
4. Wire the route in **template-platform** as a public path if the UI calls it without forcing login.

## 3. JWT or PAT — `JwtOrUserPatGuard` + `UserPatScopeGuard`

Exported from **`UserApiTokensModule`** (`JwtOrUserPatGuard`). **`UserPatScopeGuard`** is global via **`CommonModule`**. Requires a Bearer token (JWT or PAT); missing/invalid → **401**.

PAT format: `{AGENT_KEY_PREFIX}{mongoId}_{secret}` (prefix from env, default `af_`). Secret is bcrypt-hashed at rest; raw value returned only on `POST /auth/api-tokens`.

**PAT management** (`POST|GET|DELETE /auth/api-tokens`) stays **`JwtAuthGuard` only** — never accept a PAT to create or revoke tokens.

### Deny-by-default scope

On controllers that use `JwtOrUserPatGuard`, stack **`UserPatScopeGuard`** and mark automation-safe handlers with **`@AllowUserPat()`**. Session JWT is allowed on every handler on that controller; PAT on an unmarked handler → **403**.

```typescript
@Controller('swarms')
@UseGuards(JwtOrUserPatGuard, UserPatScopeGuard, RolesGuard)
@Roles(UserRole.USER)
export class SwarmsController {
  @Post(':id/run')
  @AllowUserPat()
  run() { /* ... */ }

  @Delete(':id') // no @AllowUserPat — PAT gets 403
  remove() { /* ... */ }
}
```

**Stock surfaces:** user swarms ([`SWARMS-API.md`](./SWARMS-API.md#authentication)), [`/external/processes`](./PROCESSES.md#external-api-automation). Admin routes must not use `JwtOrUserPatGuard`.

Import **`UserApiTokensModule`** in the feature module that declares PAT-aware controllers.

## 4. Roles

After any auth guard, stack **`RolesGuard`** and **`@Roles(...)`** when the route is not open to every authenticated role.

- `@Roles(UserRole.USER)` also allows **`admin`** (see guard implementation).
- Routes with no `@Roles()` metadata pass through `RolesGuard`.

Full porting notes: [`role-guard-implementation.md`](./role-guard-implementation.md).

## What we avoid in this template

- **`OptionalJwtAuthGuard` + `@Roles(UserRole.USER)`** on the same handler — roles expect a user; optional routes should branch on `user` in code instead.
- **Duplicating `/auth/me` and `/users/me`** patterns on new resources without a clear public vs private split.
- **PAT on browser-only routes** — PATs are for scripts; keep session JWT for the web app unless you have a deliberate reason.
