# agentatlas-services — docs

API prefix: **`/api/v1`**

## Topic guides

| Topic | File |
|-------|------|
| **Swarm runtime** | [`SWARMS.md`](./SWARMS.md) |
| **Agent I/O (runInput, schemas, traces)** | [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md) |
| **Swarms HTTP API** | [`SWARMS-API.md`](./SWARMS-API.md) |
| **Swarm workspace (editor contract)** | [`SWARMS-WORKSPACE.md`](./SWARMS-WORKSPACE.md) |
| **Inference (LLM providers)** | [`INFERENCE.md`](./INFERENCE.md) |
| **Agent & swarm tools** | [`TOOLS.md`](./TOOLS.md) |
| **Modules & conventions** | [`MODULES.md`](./MODULES.md) |
| **Auth guards** | [`GUARDS.md`](./GUARDS.md) |

Platform UI docs: `../agentatlas-platform/docs/SWARMS-EDITOR.md`, `SWARMS-TOOLS.md`.

## Auth (public)

- `POST /auth/register`, `GET /auth/username/availability`, `POST /auth/login`, `POST /auth/refresh`
- `POST /auth/forgot-password`, `POST /auth/reset-password`
- `GET /auth/google`, `GET /auth/google/callback`

## Auth (authenticated)

- `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`
- `POST|GET|DELETE /auth/api-tokens`

## Users

- `GET /users/me`
- Admin: `GET /users`, `GET /users/:id`, `PATCH /users/:id`

## Inference

- `GET /inference/setup` — providers, defaults, tool catalogs

## Tools

- `GET /tools`, `POST /tools/:id/run`, `POST /tools/webpage-scrape/run`
- `GET /tools/catalog` — platform integrations for prompts
- `GET /tools/integrations`, connect/disconnect endpoints

## Swarms

See [`SWARMS-API.md`](./SWARMS-API.md) for the full route list.

Highlights:

- `POST /swarms`, `GET /swarms`, workspace + graph CRUD
- `POST /swarms/:id/run/stream` — SSE test runs
- Admin mirrors under `/admin/swarms/*`
