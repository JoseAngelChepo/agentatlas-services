# Contributing to agentatlas-services

Thank you for helping improve AgentAtlas. This repo is the NestJS backend; the swarm editor lives in [agentatlas-platform](https://github.com/JoseAngelChepo/agentatlas-platform).

## Before you start

- Search [existing issues](https://github.com/JoseAngelChepo/agentatlas-services/issues) to avoid duplicate work.
- For larger features (new providers, orchestrator behavior, auth changes), open an issue first so we can align on the API contract.
- HTTP contract changes here should stay in sync with `agentatlas-platform/src/data/api/server/` when the UI consumes them.

## Development setup

```bash
git clone https://github.com/JoseAngelChepo/agentatlas-services.git
cd agentatlas-services
npm install
cp .env.example .env
# Edit .env — at minimum MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET
npm run dev
```

API: `http://localhost:3001/api/v1`

See [README.md](README.md) for MongoDB, Ollama, and optional frontend setup.

## Pull request workflow

1. Fork the repo and create a branch from `main` (e.g. `fix/inference-timeout`, `feat/ollama-defaults`).
2. Make focused changes — one logical change per PR when possible.
3. Run checks locally:

   ```bash
   npm run typecheck
   npm run build
   ```

4. Update docs if you change HTTP routes, env vars, or swarm/inference behavior (`docs/`, `.env.example`, README as needed).
5. Open a PR with:
   - **What** changed and **why**
   - How you tested it (manual steps or commands)
   - Screenshots or sample API responses if relevant

## Code guidelines

- Match existing NestJS patterns in the module you touch (`src/swarms/`, `src/inference/`, etc.).
- Prefer minimal diffs; reuse existing services and utilities.
- Do not commit secrets (`.env`, API keys, tokens).
- Comments only for non-obvious business logic — the code should read clearly on its own.

## Commit messages

Use clear, imperative subjects:

- `fix: handle missing swarm graph on duplicate`
- `feat: expose ollama in inference setup defaults`
- `docs: document local inference with Ollama`

## Reporting bugs

Include:

- Steps to reproduce
- Expected vs actual behavior
- Node version, OS, and relevant `.env` keys (never paste secret values)
- Logs or stack traces from the API

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
