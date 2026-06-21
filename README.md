# agentatlas-services

NestJS API for **agentatlas** — swarms, auth, users, inference, and tools.

Paired with **`agentatlas-platform`** (`http://localhost:3000`).

## Scope

- Swarms, agent workers, graph orchestrator
- Auth, users, API tokens
- Inference (OpenAI, Anthropic, Grok, Gemini, …)
- Tools (scrape, run_swarm)

## Develop

```bash
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:3001/api/v1`

MongoDB default: `mongodb://127.0.0.1:27017/agentatlas`

## Docs

- `docs/SWARMS.md` — orchestrator & runtime
- `docs/SWARMS-WORKSPACE.md` — editor API contract
- `docs/INFERENCE.md` — model providers
- `docs/TOOLS.md` — agent tools
