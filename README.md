# agentatlas-services

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Open-source backend for **[AgentAtlas](https://github.com/JoseAngelChepo/agentatlas-services)** — a multi-agent swarms platform. This NestJS API handles auth, users, swarm orchestration, LLM inference, and agent tools.

Paired with **[agentatlas-platform](https://github.com/JoseAngelChepo/agentatlas-platform)** (Next.js swarm editor and test panel).

## Features

- **Swarms** — graph-based multi-agent orchestration (pipeline, parallel, conditional flows)
- **Agent workers** — reusable blueprints with prompts, I/O schemas, and model config
- **Inference** — OpenAI, Anthropic, Grok, Gemini, OpenRouter, Hugging Face, **Ollama (local)**, and more
- **Tools** — webpage scrape (Firecrawl), run child swarms as tools, platform integrations
- **Auth** — JWT, refresh tokens, Google OAuth, per-user API tokens
- **Streaming** — SSE for live swarm test runs

## Requirements

- **Node.js** ≥ 20
- **MongoDB** (local or Atlas)
- Optional: [Ollama](https://ollama.com) for local inference without cloud API keys

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/JoseAngelChepo/agentatlas-services.git
cd agentatlas-services
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` at minimum:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string (default: `mongodb://127.0.0.1:27017/agentatlas`) |
| `JWT_SECRET` | Access token secret |
| `JWT_REFRESH_SECRET` | Refresh token secret |
| `CORS_ORIGIN` | Frontend URL (default: `http://localhost:3000`) |

See [`.env.example`](.env.example) for inference providers, OAuth, email, and tool keys.

### 3. Run MongoDB

Local example with Docker:

```bash
docker run -d --name agentatlas-mongo -p 27017:27017 mongo:7
```

Or use [MongoDB Atlas](https://www.mongodb.com/atlas) and set `MONGODB_URI` accordingly.

### 4. Start the API

```bash
npm run dev
```

API base URL: **`http://localhost:3001/api/v1`**

Production build:

```bash
npm run build
npm run start:prod
```

### 5. (Optional) Run the frontend

Clone and run **[agentatlas-platform](https://github.com/JoseAngelChepo/agentatlas-platform)** so the swarm editor can talk to this API. Point its API client at `http://localhost:3001/api/v1`.

## Local inference with Ollama

Run swarms entirely on your machine — no OpenAI or other cloud keys required.

### 1. Install and start Ollama

```bash
# https://ollama.com/download
ollama serve
ollama pull llama3.2
```

### 2. Configure the API

In `.env`:

```env
INFERENCE_MODE=auto
OLLAMA_INFERENCE_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
```

`INFERENCE_MODE=auto` uses Ollama when a worker’s provider is `ollama` and the base URL is set. Use `llm` to require a real model call (fail if misconfigured) or `stub` for offline dev without any LLM.

### 3. Set workers to use Ollama

In the swarm workspace (or via API), set each agent worker’s model to:

```json
{
  "model": {
    "provider": "ollama",
    "name": "llama3.2",
    "params": {
      "temperature": 0.35
    }
  }
}
```

Use any model name you have pulled locally (`ollama list`). Ollama exposes an **OpenAI-compatible** Chat Completions API; agentatlas routes `provider: "ollama"` to that endpoint.

Check configured providers (no secrets returned):

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/inference/setup
```

Details: [`docs/INFERENCE.md`](docs/INFERENCE.md).

## Project layout

| Path | Purpose |
|------|---------|
| `src/swarms/` | Orchestrator, graphs, runs, workers |
| `src/inference/` | LLM providers and setup API |
| `src/tools/` | Agent function registry |
| `src/auth/`, `src/users/` | Authentication and accounts |
| `docs/` | API and runtime documentation |

## Documentation

| Topic | File |
|-------|------|
| Swarm runtime | [`docs/SWARMS.md`](docs/SWARMS.md) |
| HTTP API | [`docs/SWARMS-API.md`](docs/SWARMS-API.md) |
| Editor / workspace contract | [`docs/SWARMS-WORKSPACE.md`](docs/SWARMS-WORKSPACE.md) |
| Inference providers | [`docs/INFERENCE.md`](docs/INFERENCE.md) |
| Agent tools | [`docs/TOOLS.md`](docs/TOOLS.md) |
| Index | [`docs/README.md`](docs/README.md) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with watch |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled app |
| `npm run typecheck` | TypeScript check without emit |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, PR workflow, and guidelines.

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE).
