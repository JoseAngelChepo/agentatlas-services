# Role guard — porting guide (NestJS)

This document describes how **RolesGuard** and the **`@Roles()`** decorator work in **template-services**, so you can reproduce the same behavior in another NestJS backend (or another framework, by adapting the ideas).

For other guards (`JwtAuthGuard`, optional auth, PAT), see [`GUARDS.md`](./GUARDS.md).

## Behavior summary

1. Protected routes use **`JwtAuthGuard`** first, then **`RolesGuard`**.
2. The **`@Roles(UserRole.USER | UserRole.ADMIN)`** decorator declares which role(s) may access the handler.
3. If the route requires **`USER`**, users with **`ADMIN`** are also allowed (implicit broadening).
4. If there is no roles metadata on the handler or the controller class, **`RolesGuard`** allows the request (`return true`).
5. If the user has no `role` on the request → **`403 Forbidden`** with a generic message (`Insufficient permissions`).
6. The JWT alone is not enough: the JWT strategy **reloads the active user** from the database and attaches `sub`, `email`, and **`role`** to `request.user`.

## Pieces in this repo

| Piece | Location |
|-------|----------|
| Guard | `src/common/guards/roles.guard.ts` |
| Decorator | `src/common/decorators/roles.decorator.ts` |
| Role enum | `src/users/schemas/user.schema.ts` (`UserRole.USER`, `UserRole.ADMIN`) |
| What populates `request.user` | `src/auth/strategies/jwt.strategy.ts` (`validate` returns `{ sub, email, role }`) |
| Global guard registration | `src/common/common.module.ts` (`RolesGuard` in `providers` + `exports`, `@Global()` module) |

## 1. `@Roles` decorator

- Metadata key: `'roles'`.
- Value: array of `UserRole`.
- Useful inline comment: *“Require one of these roles (after guard expansion: USER also allows ADMIN).”*

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

## 2. `RolesGuard`

- Inject **`Reflector`** from `@nestjs/core`.
- Read roles with **`getAllAndOverride`** on the handler and the class (handler wins if both set metadata).
- No required roles → allow.
- Read `request.user.role`; if missing → `ForbiddenException`.
- Build a `Set` of allowed roles; if **`USER`** is among the required roles, also add **`ADMIN`** to the allowed set (admins may call user-scoped endpoints).
- Ensure the user’s role matches one entry in the set (use `String(role)` for robust comparison if the DB returns strings).

## 3. Controller usage

Guard order: **JWT first**, then **roles**.

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER)
```

Admin-only routes:

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

## 4. JWT strategy and `request.user`

The guard assumes that after `JwtAuthGuard`, **`request.user`** exists with at least **`role`**.

In this project, `JwtStrategy.validate`:

1. Loads the user by `payload.sub`.
2. Ensures the user exists and is active; otherwise → `UnauthorizedException`.
3. Returns **`{ sub, email, role }`** (current role from the DB, not only whatever might be embedded in the token if those ever diverged).

Access control therefore reflects the user’s **current** state (e.g. role downgrade or deactivation).

## 5. NestJS module

- Register **`RolesGuard`** as a provider.
- If the module is **`@Global()`** and exports the guard, any feature module can use `@UseGuards(RolesGuard)` without importing the module again (as with `CommonModule` here).

**`Reflector`** is provided by Nest by default.

## 6. Porting checklist

- [ ] Role enum or type aligned with your user model.
- [ ] Auth guard that sets **`user.role`** on the request (or adapt the roles guard to your session shape).
- [ ] Decide whether you want the same **“USER implies ADMIN allowed”** rule; if not, remove that `Set` expansion in the guard.
- [ ] Error messages and HTTP codes (`403` vs `401`) consistent with your API.
- [ ] Tests: route without `@Roles` vs `@Roles(USER)` vs `@Roles(ADMIN)`; user without role; admin hitting a USER route.

## 7. Other frameworks

The pattern is the same outside Nest:

- **Route metadata** (required roles).
- **Middleware / guard** that runs **after** authentication.
- Optional **inclusion policy** (admin can use USER routes) if you want parity.

---

*Internal reference: implementation in **template-services** (NestJS, Passport JWT, Mongoose `User.role`).*
