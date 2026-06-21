# Inference — swarm worker LLM execution

How **agentatlas-services** calls language models when running swarms. Adapted from **the-constraint-services** (`InferenceProviderService`), trimmed for non-streaming worker runs.

**Related:** [`SWARMS-WORKSPACE.md`](./SWARMS-WORKSPACE.md) (UI), [`SWARMS.md`](./SWARMS.md) (orchestrator), [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md) (run input & contracts), [`SWARMS-API.md`](./SWARMS-API.md) (HTTP), [`TOOLS.md`](./TOOLS.md) (agent & swarm tools).

---

## Architecture

```text
SwarmOrchestrator
       │
       ▼
RoutingWorkerExecutorService  ◄── INFERENCE_MODE (auto | llm | stub)
       │
       ├── StubWorkerExecutorService   (offline / missing keys)
       └── LlmWorkerExecutorService
                 │
                 ▼
           InferenceProviderService
                 │
     ┌───────────┼──────────────────────────┐
     ▼           ▼                          ▼
 openai_direct  claude_direct    openrouter / hf / ollama / inference_net / grok_direct / gemini_direct
 (Responses API  (Anthropic API)   (Chat Completions compatible)
  on api.openai.com)                (Gemini: native Generative Language API)
```

| Component | Path |
|-----------|------|
| Provider router | `src/swarms/orchestrator/routing-worker-executor.service.ts` |
| LLM executor | `src/swarms/orchestrator/llm-worker-executor.service.ts` |
| Agent tool registry | `src/tools/registry/tool-registry.service.ts` |
| Swarm-as-tool | `src/swarms/services/swarm-as-tool.service.ts` |
| Stub executor | `src/swarms/orchestrator/stub-worker-executor.service.ts` |
| HTTP client | `src/inference/inference-provider.service.ts` |
| OpenAI Responses | `src/inference/openai/openai-responses-inference.service.ts` |
| Setup API | `GET /inference/setup` |
| OpenAI pricing (run cost) | `src/inference/pricing/` (list prices; used when aggregating `swarm_runs.costUsd`) |
| Swarm run stats aggregation | `src/swarms/stats/` |
| Browser scrape pricing | `src/scraper/pricing/browser-scrape-pricing.ts` ($0.09/hr) |

Injection token `AGENT_WORKER_EXECUTOR` resolves to **`RoutingWorkerExecutorService`**.

---

## Execution modes (`INFERENCE_MODE`)

| Mode | Behavior |
|------|----------|
| `auto` (default) | Use LLM if the worker’s `model.provider` is configured in env; otherwise stub. |
| `llm` | Always call the provider; fail if keys missing. |
| `stub` | Never call upstream models (fast local dev). |

---

## Choosing a provider (per worker)

Each **AgentWorker** stores:

```json
{
  "model": {
    "provider": "openai_direct",
    "name": "gpt-4o-mini",
    "contextWindow": 128000,
    "params": {
      "temperature": 0.35,
      "maxTokens": 2048,
      "jsonMode": true
    }
  }
}
```

### `model.provider` (routing)

Normalized aliases map to an internal kind:

| You set | Routed as |
|---------|-----------|
| `openai`, `openai_direct` | `openai_direct` |
| `anthropic`, `claude`, `claude_direct` | `claude_direct` |
| `openrouter` | `openrouter` |
| `huggingface`, `hf`, `hugging_face` | `hugging_face` |
| `inference_net`, `inference.net` | `inference_net` |
| `ollama` | `ollama` |
| `grok`, `xai`, `grok_direct` | `grok_direct` |
| `gemini`, `google`, `gemini_direct`, `google_gemini` | `gemini_direct` |

Unknown values default to **`openai_direct`**. Valid canonical ids (e.g. `grok_direct`, `gemini_direct`) are passed through as-is.

### `model.name` vs `model.params.model`

- **`name`**: Display / default model id.
- **`params.model`**: Optional override sent to the API (wins over `name`).

### `model.params` (generation)

| Key | Type | Notes |
|-----|------|-------|
| `temperature` | number | 0–2; default from `INFERENCE_DEFAULT_TEMPERATURE` |
| `maxTokens` | number | Capped at 32 000; OpenAI uses `max_tokens` or `max_completion_tokens` by model family |
| `jsonMode` | boolean | OpenAI-compatible: `response_format: json_object` |
| `model` | string | Overrides `model.name` for the API call |

Service defaults apply when params are omitted.

---

## Environment variables

See [`.env.example`](../.env.example). Summary:

| Variable | Purpose |
|----------|---------|
| `INFERENCE_MODE` | `auto` \| `llm` \| `stub` |
| `INFERENCE_DEFAULT_*` | Fallback model / temperature / timeout |
| `OPENAI_API_KEY` or `INFERENCE_API_KEY` | OpenAI direct |
| `INFERENCE_BASE_URL` | OpenAI-compatible base (default `https://api.openai.com/v1`) |
| `ANTHROPIC_API_KEY` | Claude native API |
| `OPENROUTER_API_KEY` | OpenRouter |
| `HF_TOKEN` | Hugging Face router |
| `INFERENCE_NET_*` | Inference.net |
| `OLLAMA_INFERENCE_BASE_URL` | Local Ollama (`http://localhost:11434/v1`) |
| `XAI_API_KEY` or `GROK_API_KEY` | xAI Grok (OpenAI-compatible) |
| `GROK_INFERENCE_BASE_URL` | Grok API base (default `https://api.x.ai/v1`) |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google Gemini (native API) |
| `GEMINI_INFERENCE_BASE_URL` | Gemini API base (default `https://generativelanguage.googleapis.com/v1beta`) |

**Grok hosted tools:** When a worker has `grokTools.xSearch` or `grokTools.webSearch`, inference uses `GrokResponsesInferenceService` (`POST /v1/responses` on api.x.ai). Without those flags, Grok uses Chat Completions unchanged. See `docs/SWARMS-AGENT-IO.md#grok-tools-x_search`.

---

## Setup API (frontend)

### `GET /api/v1/inference/setup`

Authenticated (`user` role). Returns catalog **without secrets**:

```json
{
  "mode": "auto",
  "defaults": {
    "provider": "openai_direct",
    "model": "gpt-4o-mini",
    "temperature": 0.35,
    "maxTokens": null,
    "timeoutMs": 120000
  },
  "providers": [
    {
      "id": "openai_direct",
      "label": "OpenAI",
      "configured": true,
      "envKeys": ["OPENAI_API_KEY", "INFERENCE_API_KEY"],
      "defaultBaseUrl": "https://api.openai.com/v1"
    }
  ],
  "workerModelParams": {
    "description": "...",
    "keys": ["temperature", "maxTokens", "jsonMode", "model"]
  },
  "runInputConvention": {
    "input": "Use any JSON object in `input` for POST /swarms/:id/run ..."
  },
  "agentTools": {
    "workerField": "agentTools",
    "catalog": [/* webpage_scrape, run_swarm, configured, inputSchema */]
  },
  "swarmTools": {
    "workerField": "swarmTools",
    "functionNamePattern": "swarm_<swarmObjectId>"
  }
}
```

Use this to build provider pickers, tool pickers, and “not configured” warnings in the swarm workspace. Tool details: [`TOOLS.md`](./TOOLS.md).

---

## Prompt assembly

`buildWorkerChatMessages` (`src/inference/utils/build-worker-messages.ts`):

1. **System:** worker `systemPrompt` (Instructions) — `{{…}}` resolved; when the worker has executable `agentTools` and/or `swarmTools`, a **Connected tools** block is appended (function name, purpose, args, response handling). See [`TOOLS.md` — Connected tools prompt block](./TOOLS.md#connected-tools-prompt-block).
2. **`promptMessages`:** optional extra `system` / `user` entries from the worker blueprint — `{{…}}` resolved

Other context (goal, run input, upstream, shared) is not auto-injected — use `{{goal}}`, `{{runInput.*}}`, `{{shared.*}}`, `{{upstream}}`, `{{upstream.<ref>.<field>}}`, or flat `{{<field>}}` when unique across predecessors.

**OpenAI / Grok direct:** all `system` messages → Responses `instructions`; all `user` messages → `input` (`splitMessagesForResponses`).

Upstream comes from the graph (or manual `upstream` on worker preview). Run `input` is a free-form object (`message`, `summary`, etc.); see [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md).

### Tool calling (OpenAI functions)

When a worker lists `agentTools` and/or `swarmTools`, `LlmWorkerExecutorService` merges OpenAI function definitions (with `run_swarm` deduped when `swarmTools` is set) and runs a tool loop (`onToolCall`). Platform tools use `ToolRegistryService`; child swarms use `SwarmAsToolService` → `runSwarmAsAgentTool`. Requires `openai_direct` on `api.openai.com`. Full flow: [`TOOLS.md` — Inference runtime](./TOOLS.md#inference-runtime).

---

## Output shape

`parseWorkerLlmOutput`:

- If the model returns JSON (or ```json fence), parse to object.
- Else `{ result: text, text }`.

LLM runs also attach metadata:

```json
{
  "result": "...",
  "_inference": {
    "provider": "openai_direct",
    "model": "gpt-4o-mini",
    "finishReason": "stop",
    "latencyMs": 842,
    "usage": { "promptTokens": 120, "completionTokens": 45 }
  }
}
```

**Agent runs** persist `messages[]` (system, user, assistant), `inference.request` / `inference.response`, and token counts when using the LLM executor. Business output lives in `output`; see [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md#persisted-agent_runs-audit-vs-business).

---

## SSE swarm run stream

For the workspace **test panel**, prefer streaming over blocking `POST /run`.

| Endpoint | Use |
|----------|-----|
| `POST /swarms/:id/run/stream` | Full swarm (panel derecho) |
| `POST /agent-workers/:id/run/stream` | Single-worker preview |

**Headers:** `Authorization: Bearer …`, `Content-Type: application/json`, `Accept: text/event-stream`

**Body:** same as non-streaming (`RunSwarmDto` / `RunAgentWorkerDto`).

**Response:** `Content-Type: text/event-stream` — one JSON object per line prefixed with `data: `.

### Event types

All graph lifecycle events include **`nodeId`** (canvas / API graph node id), **`wave`** (scheduler batch — nodes in the same wave may run in parallel; `wave` resets to `0` on each new SSE connection, e.g. after approval resume), and **`step`** (monotonic run counter).

| `type` | When | Payload |
|--------|------|---------|
| `swarm_start` | Run created | `swarmId`, `swarmRunId`, `runKind` |
| `node_start` | Any node begins (control + worker) | `nodeId`, `nodeKind`, `nodeName`, `step`, `wave` |
| `node_done` | Any node finished | `nodeId`, `nodeKind`, `nodeName`, `step`, `wave`, `output`, `latencyMs` |
| `node_skipped` | Branch pruned or unreachable | `nodeId`, `nodeKind`, `nodeName`, `wave`, `reason` (`branch_pruned` \| `unreachable`), optional `fromNodeId` |
| `worker_start` | Worker inference begins (paired with `node_start` for workers) | `nodeId`, `workerId`, `workerName`, `step`, `wave` |
| `worker_meta` | Provider connected | `nodeId`, `workerId`, `provider`, `model`, `baseURL`, `wave` |
| `delta` | Token chunk | `nodeId`, `workerId`, `delta`, `wave` |
| `worker_done` | Worker finished (paired with `node_done` for workers) | `nodeId`, `workerId`, `agentRunId`, `output`, `latencyMs`, `step`, `wave`, optional `inferenceRequest`, `inference`, `messages` |
| `approval_required` | Paused at user-approval node — stream closes | `approvalId`, `swarmRunId`, `swarmId`, `nodeId`, `name`, `message`, `passthrough`, `assigneeUserId` |
| `swarm_done` | Success | `swarmRun`, `output`, `durationMs`, token/cost fields |
| `error` | Failure | `message` |

**`nodeKind`:** `start` \| `scraper` \| `swarm` \| `ifelse` \| `while` \| `user_approval` \| `user_input` \| `end` \| `worker`

After `swarm_done`, the stream closes. On `approval_required`, the stream closes until the client opens the approval resume stream. On `error`, the run is marked `failed` in the database when possible.

### Canvas loaders (frontend)

Prefer **`node_start` / `node_done` / `node_skipped`** keyed by `nodeId` for all node types (including workers). Worker-specific events remain for token streaming and audit panels.

```typescript
type NodeRunState = 'idle' | 'running' | 'done' | 'skipped' | 'waiting';

function applySwarmSseToCanvas(state: Map<string, NodeRunState>, event: SwarmSseEvent) {
  switch (event.type) {
    case 'node_start':
      state.set(event.nodeId, 'running');
      break;
    case 'node_done':
      state.set(event.nodeId, 'done');
      break;
    case 'node_skipped':
      state.set(event.nodeId, 'skipped');
      break;
    case 'approval_required':
      state.set(event.nodeId, 'waiting');
      break;
  }
}
```

Worker preview (`POST /agent-workers/:id/run/stream`) uses `nodeId === workerId` when the worker is not on a saved graph.

### Frontend example (fetch)

```typescript
async function runSwarmStream(
  apiBase: string,
  token: string,
  swarmId: string,
  message: string,
  handlers: {
    onDelta: (workerId: string, delta: string) => void;
    onWorkerStart?: (workerId: string, name: string, step: number) => void;
    onDone?: (output: unknown, swarmRun: unknown) => void;
    onError?: (message: string) => void;
  },
) {
  const res = await fetch(`${apiBase}/swarms/${swarmId}/run/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ input: { message } }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as { type: string };
      if (event.type === 'delta' && 'delta' in event && 'workerId' in event) {
        handlers.onDelta(
          String((event as { nodeId?: string }).nodeId ?? event.workerId),
          String(event.delta),
        );
      }
      if (event.type === 'worker_start' && 'workerId' in event) {
        handlers.onWorkerStart?.(
          String((event as { nodeId?: string }).nodeId ?? event.workerId),
          String((event as { workerName?: string }).workerName ?? ''),
          Number((event as { step?: number }).step ?? 0),
        );
      }
      if (event.type === 'swarm_done') {
        handlers.onDone?.(
          (event as { output?: unknown }).output,
          (event as { swarmRun?: unknown }).swarmRun,
        );
      }
      if (event.type === 'error') {
        handlers.onError?.(String((event as { message?: string }).message ?? 'Error'));
      }
    }
  }
}
```

**UI tips:**

- Append `delta` for the **active** `workerId` (highlight node on canvas).
- On `swarm_done`, show `output` in the panel (exit node result).
- Keep `POST /swarms/:id/run` for simple clients that do not need streaming.

---

## Scope

### In scope

- Non-streaming chat completion per worker
- **SSE streaming** for swarm + worker preview runs
- Multi-provider routing via worker `model.provider`
- Per-worker params + env defaults
- Auto/stub fallback for local dev
- `GET /inference/setup` for UI configuration

### Out of scope (future)

- Idempotency keys per turn
- Rate limits / spend floors (see floors module)
- Extra prompt roots beyond `goal` / `runInput` / `upstream` / `shared` — see [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md#prompt-variables--in-systemprompt)
- Tool / function calling

---

## Local quick start

```bash
# .env
INFERENCE_MODE=llm
OPENAI_API_KEY=sk-...

# Worker in API
{
  "model": {
    "provider": "openai_direct",
    "name": "gpt-4o-mini",
    "contextWindow": 128000,
    "params": { "temperature": 0.3, "maxTokens": 1024 }
  }
}
```

Then `POST /swarms/:id/run` with any input payload your worker expects, for example:

```json
{ "input": { "summary": "User greeted in Spanish." } }
```

Without keys, use `INFERENCE_MODE=stub` or leave `auto` and accept stub output `{ stub: true, ... }`.
