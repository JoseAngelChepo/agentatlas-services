# Swarm agent I/O — contracts, run input, and traces

How **AgentWorker** blueprints define what goes in and out of each node, how the orchestrator assembles context, and what gets persisted on **`agent_runs`**.

**Related:** [`SWARMS.md`](./SWARMS.md), [`SWARMS-API.md`](./SWARMS-API.md), [`SWARMS-WORKSPACE.md`](./SWARMS-WORKSPACE.md), [`INFERENCE.md`](./INFERENCE.md).

---

## Mental model

Each worker execution has three separate concerns:

| Layer | Who sets it | Purpose |
|-------|-------------|---------|
| **Run input** | Caller (`POST …/run`, test panel) | Initial payload for the whole swarm run (`SwarmContext.runInput`). |
| **Upstream** | Graph + previous workers | Outputs from nodes with an edge into this worker. |
| **Worker output** | LLM (or stub) | Structured result stored on `agent_runs.output` for downstream nodes. |

```text
Caller                    Worker A                 Worker B
  │                          │                        │
  │  runInput (any JSON)     │                        │
  ├─────────────────────────►│                        │
  │                          │  output (JSON)         │
  │                          ├───────────────────────►│
  │                          │  upstream + {{…}}      │
  │                          │  → prompt assembly     │
```

**Prompt assembly:** Instructions (`systemPrompt`) + optional `promptMessages` only. All context reaches the model via `{{…}}` tokens or explicit message bodies. See [Prompt assembly (runtime)](#prompt-assembly-runtime).

**Important:** `runInput` is **not** tied to a field named `message`. It is a free-form object. The API accepts any shape; workers consume whatever you configure in Instructions / `promptMessages` (+ optional filtering; see [Input filtering](#input-filtering-current-and-planned)).

---

## Run input (`input` on run endpoints)

### Endpoints

| Endpoint | Body field | Stored as |
|----------|------------|-----------|
| `POST /swarms/:id/run` | `input?` | `swarm_runs.input` + `SwarmContext.runInput` |
| `POST /swarms/:id/run/stream` | `input?` | same |
| `POST /agent-workers/:id/run` | `input?` | same (preview) |

`input` is **optional** and validated only as `Record<string, unknown>` (no required keys).

### Examples

**User text (classic test panel):**

```json
{ "input": { "message": "Hola" } }
```

**Pre-summarized pipeline (no `message`):**

```json
{ "input": { "summary": "User greeted in Spanish; wants assistance." } }
```

**Both (when a later worker needs raw text + prior synthesis):**

```json
{
  "input": {
    "message": "Hola",
    "locale": "es"
  }
}
```

### When to use `message` vs `summary`

| Field | Typical source | Use when |
|-------|----------------|----------|
| `message` | User / UI | You need the **original** user text in the prompt. |
| `summary` | Prior step or external preprocessor | You only need a **digest**; upstream workers already analyzed raw input. |

If you only send `summary`, workers should be configured (prompt + `inputPick` when implemented) to **not** expect `message`. Nothing in the backend requires `message` to exist.

### How run input reaches the model

Add a `promptMessages` entry (or `{{runInput.<key>}}` in Instructions / other messages). The backend does not auto-inject a `## Run input` block.

Example:

```json
{ "role": "user", "content": "{{runInput.message}}" }
```

---

## Prompt context (`{{…}}`)

`{{goal}}`, `{{runInput.*}}`, and `{{shared.*}}` are always available for substitution when the run carries that data. Include them in Instructions or `promptMessages` only when the model should see them.

**Upstream** is available via `{{upstream}}` (full JSON), `{{upstream.<ref>.<field>}}`, or flat `{{<field>}}` when the key is unique across predecessors — add explicitly in Instructions or `promptMessages`.

---

## Extra prompt messages (`promptMessages`)

Optional ordered list on each **AgentWorker** for messages **after** Instructions (`systemPrompt`). Use this for extra `system` context, or `user` payloads (e.g. run input) without duplicating the Instructions editor.

| Field | Type | Notes |
|-------|------|-------|
| `promptMessages` | `{ role: "system" \| "user", content: string }[]` | Default `[]`. |

**Assembly order (every run):**

1. **`systemPrompt`** — always first `system` message (Instructions).
2. **`promptMessages`** — each entry appended in order (`{{…}}` resolved; empty after substitution skipped).

Goal, run input, shared, and upstream are **only** included when you reference them via `{{…}}` or explicit message bodies.

### Responses API mapping

OpenAI / Grok direct runs use `splitMessagesForResponses`:

- All `system` messages (`systemPrompt` + any `system` entries in `promptMessages`) → `instructions`
- All `user` messages (in order, joined) → `input`

Example — Instructions vs extra system rule vs user payload:

```json
{
  "systemPrompt": "You summarize user messages. Return JSON per output schema.",
  "promptMessages": [
    {
      "role": "system",
      "content": "Tone: professional. Never include PII in the summary."
    },
    {
      "role": "user",
      "content": "{{runInput.message}}"
    }
  ]
}
```

`POST/PATCH /agent-workers` body:

```json
{
  "promptMessages": [
    { "role": "system", "content": "Extra rules…" },
    { "role": "user", "content": "{{runInput.message}}" }
  ]
}
```

---

## Prompt variables (`{{…}}`)

The workspace **Instructions** and **Messages** editors insert tokens such as `{{upstream.summary}}`. The backend resolves them **on every run** in `substitutePromptVariables` (`src/inference/utils/substitute-prompt-variables.ts`) on `systemPrompt` and each `promptMessages` entry before calling the model.

| Token | When it resolves |
|-------|------------------|
| `{{goal}}` | Swarm goal |
| `{{runInput.<key>}}` | Run payload |
| `{{shared.<key>}}` | Shared run state |
| `{{upstream}}` | Full upstream outputs array (JSON) |
| `{{upstream.<field>}}` | Only when this worker has **one** graph predecessor |
| `{{upstream.<slug>.<field>}}` | Predecessor matched by worker **name slug** (e.g. `intake` → `{{upstream.intake.summary}}`) |
| `{{upstream.<0>.<field>}}` | Predecessor by index (edge order) |
| `{{upstream.<workerId>.<field>}}` | Predecessor by MongoDB worker id |
| `{{upstream.swarm.<field>}}` | Predecessor is a **sub-swarm** node on the **success** branch (slug `swarm`) |
| `{{<field>}}` | Shorthand when `<field>` is unique across all upstream payloads (same resolver as flat paths) |

**Notes**

- Field names usually come from the predecessor’s `outputSchema.properties` (or suggested keys in the UI). For sub-swarm predecessors, use the child swarm’s **End node output keys** (see [Upstream from sub-swarm nodes](#upstream-from-sub-swarm-nodes)).
- With `compressOutput: true`, values may live under a `summary` wrapper; the resolver reads both flat keys and that wrapper.
- Unresolved tokens become an empty string (no `{{…}}` left in the prompt sent to the model).
- Add goal / run input / shared as `promptMessages` or inline `{{…}}` when the model should see them.
- Arbitrary caller-provided fields are available as `{{runInput.*}}` — see [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md#run-input).

### Upstream from sub-swarm nodes

When a worker is wired **after** a sub-swarm node on the **`success`** handle, upstream resolution unwraps the child run: the worker sees the **child swarm’s End output object** (top-level keys from the child’s exit node), not the internal `swarm_runs` record.

```text
Parent graph:  … → [Sub-swarm] ──success──→ Worker B
Child graph:   Start → … → End  →  { "summary": "…", "sources": […] }

Worker B upstream[0] ≈ { "summary": "…", "sources": […] }
```

| What you need | Token in worker Instructions / `promptMessages` |
|---------------|-----------------------------------------------|
| One field from the child End output | `{{upstream.summary}}` (single predecessor) or `{{summary}}` if unique |
| Explicit sub-swarm slug | `{{upstream.swarm.summary}}` |
| Full predecessor JSON | `{{upstream}}` |

**Where the keys come from:** `GET /swarms/:id/workspace` → `referencedSwarms[].outputs` lists each referenced child’s End field keys. The platform sub-swarm inspector shows the same list when you pick a child swarm.

**Mapping into the child (sub-swarm node `data.inputFields`):** expressions use the swarm expression context (`evaluateSwarmExpression`), not `substitutePromptVariables`. Prefer:

| `source` | Example `valuePath` | Resolves |
|----------|---------------------|----------|
| `upstream` | `summary` or `upstream.summary` | Field from the node wired into the sub-swarm |
| `upstream` | `output.summary` | Same as primary upstream (`output` aliases `upstream[0]` in expressions) |
| `runInput` | `message` | `runInput.message` on the parent run |
| `shared` | `draft` | `shared.draft` on the parent run |
| `static` | — | `staticValue` literal / JSON |

Leave `inputFields` empty to **passthrough** the full upstream object into the child `runInput` (merged with optional `passShared`).

**Failed branch:** nodes on the `failed` handle still receive an upstream payload, but the child End output is usually `null`. Downstream prompts may see metadata such as `kind: "swarm"`, `branchHandle: "failed"`, and `error` instead of End keys — design failed-branch workers accordingly.

**Contrast with scraper:** scraper upstream uses slug `scraper` and fields like `content`, `url`, `status` (`{{upstream.scraper.content}}`). Sub-swarm upstream uses slug `swarm` and **child End keys** on success.

See also: [`SWARMS.md` — Sub-swarm control nodes](./SWARMS.md#sub-swarm-control-nodes), [`SWARMS-WORKSPACE.md` — Sub-swarm node](./SWARMS-WORKSPACE.md#sub-swarm-node-platform-editor).

---

## Output contract (`outputSchema`)

Defines the **JSON shape the worker should produce**.

Example — intake node:

```json
{
  "outputSchema": {
    "type": "object",
    "required": ["summary", "intent"],
    "properties": {
      "summary": { "type": "string" },
      "intent": { "type": "string" }
    }
  }
}
```

### OpenAI direct — Responses API (not Chat Completions)

When **`model.provider` is `openai_direct`** and the endpoint is **`api.openai.com`**, every worker run uses **`POST /v1/responses`** with streaming — not `chat/completions`.

Structured output is sent as:

```json
"text": {
  "format": {
    "type": "json_schema",
    "name": "intake",
    "strict": true,
    "schema": { "...": "from outputSchema" }
  }
}
```

Implemented in `OpenAiResponsesInferenceService` (`client.responses.create`).

**You do not need** lines like `Respond with JSON only: { "summary": string, … }` in `systemPrompt` for OpenAI workers with a valid `outputSchema`. Keep behavioral instructions only (“summarize intent”, tone, etc.).

| Provider | `outputSchema` behavior |
|----------|------------------------|
| `openai_direct` (api.openai.com) | Responses API `text.format.json_schema` |
| `openai_direct` (custom base URL) | Chat Completions fallback + `response_format` |
| Other providers | Prompt + optional `jsonMode` only (no schema API yet) |

Future: Responses API + Zod (`responses.parse` + `zodTextFormat`) for workers that ship Zod defs.

### OpenAI tools (`openaiTools`)

Per-worker tools on the **Responses API** request. Requires `model.provider: openai_direct` and `api.openai.com` (same path as all OpenAI direct runs).

```json
{
  "openaiTools": {
    "webSearch": true,
    "webSearchContextSize": "medium",
    "toolChoice": "auto"
  }
}
```

| Field | Description |
|-------|-------------|
| `webSearch` | Enables hosted `{ "type": "web_search" }` |
| `webSearchContextSize` | `low` \| `medium` \| `high` |
| `webSearchAllowedDomains` | Allowlist (max 100 domains) |
| `toolChoice` | `auto` \| `required` \| `none` |
| `functions` | Custom function tool definitions |
| `hosted` | Other hosted tools (e.g. `file_search`) passed through |

When `webSearch` is enabled, the run uses `POST /v1/responses` with streaming. Sources can appear in `inference.response.raw.webSearchCalls`. Prompt the model to search when needed — with `toolChoice: "required"` it must call a tool.

### Grok tools (`grokTools`) {#grok-tools-x_search}

Per-worker tools on the **xAI Responses API**. Requires `model.provider: grok_direct` and `api.x.ai`. Separate from `openaiTools` — OpenAI workers are unchanged.

```json
{
  "grokTools": {
    "xSearch": true,
    "toolChoice": "auto",
    "xSearchAllowedHandles": ["xai"],
    "xSearchFromDate": "2025-01-01"
  }
}
```

| Field | Description |
|-------|-------------|
| `xSearch` | Enables hosted `{ "type": "x_search" }` (xAI may call `x_keyword_search`, `x_semantic_search`, `x_user_search`, `x_thread_fetch` server-side) |
| `xSearchAllowedHandles` | Only posts from these handles (max 20, no `@`) |
| `xSearchExcludedHandles` | Exclude handles (max 20; cannot combine with allowed) |
| `xSearchFromDate` / `xSearchToDate` | `YYYY-MM-DD` range |
| `xSearchEnableImageUnderstanding` | Analyze images in posts |
| `xSearchEnableVideoUnderstanding` | Analyze videos in posts |
| `webSearch` | Optional xAI hosted `{ "type": "web_search" }` |
| `toolChoice` | `auto` \| `required` \| `none` |

When `xSearch` or `webSearch` is set, the run uses `POST https://api.x.ai/v1/responses`. Counts may appear in `inference.response.raw.xSearchCalls` / `webSearchCalls`. Without grok tools, Grok workers use Chat Completions as before.

### Agent tools (`agentTools`) {#agent-tools}

Platform function tools invoked by the model during inference (OpenAI Responses API). Requires `model.provider: openai_direct` and `api.openai.com`.

```json
{
  "agentTools": ["webpage_scrape", "run_swarm"]
}
```

| Tool id | Description |
|---------|-------------|
| `webpage_scrape` | Cloudflare Browser Run scrape → markdown JSON |
| `run_swarm` | Run another swarm by id (`swarmId` + optional `input`). **Omitted at inference** when `swarmTools` is non-empty — use dedicated `swarm_<id>` functions instead. |

Catalog and env status: `GET /inference/setup` → `agentTools.catalog`, or `GET /tools`.

Full reference (HTTP, schemas, adding tools): [`TOOLS.md`](./TOOLS.md).

### Swarm tools (`swarmTools`) {#swarm-tools}

Child swarms exposed as **named OpenAI functions** on the worker. Each id in `swarmTools` becomes `swarm_<objectId>` at inference time.

```json
{
  "swarmTools": ["674abc123def456789012345"],
  "agentTools": ["webpage_scrape"]
}
```

The model’s JSON args become the **child swarm run input**. Execution is linked to the parent run as a sub-swarm (nesting limits and access checks apply).

| Field | Description |
|-------|-------------|
| `swarmTools` | MongoDB swarm ids allowed on this worker |
| Function name | `swarm_<24-char-hex-id>` |
| vs `run_swarm` | Non-empty `swarmTools` → only `swarm_<id>` functions are exposed; generic `run_swarm` is skipped even if listed in `agentTools` |

See [`TOOLS.md` — Swarm tools](./TOOLS.md#swarm-tools-swarmtools) and [`TOOLS.md` — run_swarm vs swarmTools](./TOOLS.md#run_swarm-vs-swarmtools) for response shape, prompt block, and vs graph sub-swarm nodes.

**Practices:**

- Put **behavior** in `systemPrompt`, **shape** in `outputSchema`.
- `model.params.jsonMode` is optional when `outputSchema` is used on OpenAI direct (auto-enabled).
- Downstream workers should pick fields from **upstream output**, not assume they exist on `runInput`.

`inputSchema` is optional metadata for manual/preview input; it does not gate swarm runs today.

---

## Input filtering (current and planned)

### Target design: `inputPick` (recommended)

Per worker, configure which slices of context are passed into the prompt:

```ts
inputPick?: {
  runInput?: { paths?: string[] };
  upstream?: { paths?: string[] };
  shared?:   { paths?: string[] };
}
```

**Rule (no `full` / `pick` modes):**

- `paths` **missing or `[]`** → include **entire** object for that source.
- `paths` **non-empty** → include only those paths (dot notation), e.g. `"data.dato1"`, `"summary"`.

Example — responder only needs synthesis + user text:

```json
{
  "inputPick": {
    "runInput": { "paths": ["message"] },
    "upstream": { "paths": ["summary", "intent"] }
  }
}
```

Example — intake only needs user text, no upstream:

```json
{
  "inputPick": {
    "runInput": { "paths": ["message"] },
    "upstream": { "paths": [] }
  }
}
```

Example — summary-only run input:

```json
{
  "inputPick": {
    "runInput": { "paths": ["summary"] },
    "upstream": { "paths": [] }
  }
}
```

> **Status:** `inputPick` is specified here for product/API alignment. Runtime today uses `compressOutput` + `upstreamFields` (see below). Migrate workers to `inputPick` when the backend lands.

### Current implementation: `compressOutput` + `upstreamFields`

| Field | Default | Behavior today |
|-------|---------|----------------|
| `compressOutput` | `false` | If `true`, each upstream output is wrapped as `{ summary: { …picked fields } }`. |
| `upstreamFields` | `[]` | If `compressOutput` is true: allowlist of top-level keys from upstream output. Empty → defaults: `summary`, `intent`, `result`, `decision`, `data`, `confidence`, `reason`. |

**Limitation:** top-level keys only (no `data.dato1` paths yet). Prefer implementing `inputPick` before building complex nested filters.

`runInput` is **not** filtered by these fields today — full `runInput` is always passed unless you implement `inputPick`.

---

## Prompt assembly (runtime)

`resolveWorkerInput` → `AgentWorkerRunInput`:

| Key | Source |
|-----|--------|
| `goal` | Swarm goal |
| `systemPrompt` | Worker blueprint |
| `upstream` | Graph predecessors (optionally compressed) |
| `shared` | `SwarmContext` shared map |
| `runInput` | Caller `input` |

`buildWorkerChatMessages` builds:

1. **System:** `systemPrompt`, plus an optional **Connected tools** appendix when the worker lists executable `agentTools` and/or `swarmTools` (one section per function: purpose, when to call, args, response handling). See [`TOOLS.md` — Connected tools prompt block](./TOOLS.md#connected-tools-prompt-block).
2. **`promptMessages`** (optional `system` / `user` entries)

No automatic upstream block — use `{{upstream}}` or field tokens when needed.

**Note:** `Connected tools` in `{{runInput.toolsAvailable}}` refers to the **platform integration catalog** (Gmail, Slack, …), not agent/swarm function tools — see [`TOOLS.md`](./TOOLS.md#platform-integrations-catalog).

---

## Persisted `agent_runs` (audit vs business)

| Field | Content |
|-------|---------|
| `input` | Resolved `AgentWorkerRunInput` (what the orchestrator thought the worker saw). |
| `output` | **Business result** only (parsed JSON from the model, e.g. `summary`, `intent`, `result`). |
| `messages` | Chat transcript: system, user (assembled prompt), assistant (raw model text). |
| `inference.request` | Provider HTTP **body** only (e.g. OpenAI `chat.completions` payload). No API keys. |
| `inference.response` | Provider result metadata + text (`provider`, `model`, `usage`, `finishReason`, …). |

Put technical telemetry in **`inference`**, not inside `output`. Legacy runs may still have `output._inference`; new runs should rely on `agent_run.inference`.

### Example document (abbreviated)

```json
{
  "input": {
    "goal": "…",
    "systemPrompt": "…",
    "upstream": [],
    "runInput": { "summary": "…" }
  },
  "output": {
    "summary": "…",
    "intent": "…"
  },
  "messages": [ … ],
  "inference": {
    "request": {
      "model": "gpt-4o-mini",
      "messages": [ … ],
      "temperature": 0.35
    },
    "response": {
      "text": "{ … }",
      "usage": { "promptTokens": 90, "completionTokens": 35 }
    }
  }
}
```

---

## End-to-end example (two-node pipeline)

### 1. Caller

```json
POST /swarms/:id/run
{ "input": { "message": "Hola" } }
```

### 2. Worker `intake`

- `outputSchema`: `{ summary, intent }`  
- `runInput` paths (future): `["message"]`

Produces `output: { "summary": "…", "intent": "…" }`.

### 3. Worker `responder`

- `upstream` paths (future): `["summary", "intent"]`  
- `runInput` paths (future): `["message"]` or `[]` if only upstream matters  

Produces `output: { "result": "…" }` → swarm run final output (exit node).

### 4. Summary-only variant

```json
POST /swarms/:id/run
{ "input": { "summary": "User greeted in Spanish." } }
```

Configure intake/responder with `inputPick.runInput.paths: ["summary"]` and prompts that never mention `message`.

---

## Frontend checklist

- Test panel: allow arbitrary JSON in `input`, not only `{ message }`.
- Worker inspector: **Instructions** (`systemPrompt`), **Messages** (`promptMessages`), `outputSchema`, and (when available) `inputPick`.
- **Add Local Context** picker: always offer `{{goal}}`, `{{runInput.*}}`, `{{shared.*}}`, upstream — no per-worker enable flags.
- Show `agent_run.inference.request` / `response` in a debug drawer; show `output` as the business payload.
- Document per-worker which `runInput` keys the swarm expects in workspace help text.

---

## API quick reference

| Worker field | Role |
|--------------|------|
| `systemPrompt` | Agent behavior (Instructions) |
| `promptMessages` | Extra `system` / `user` messages |
| `outputSchema` | Expected output JSON contract |
| `inputSchema` | Optional input contract (preview/docs) |
| `compressOutput` | **Legacy** upstream key filter |
| `upstreamFields` | **Legacy** keys when `compressOutput` is true |
| `inputPick` | **Planned** path-based filter for `runInput` / `upstream` / `shared` |

Run body: `{ "input": <any object> }` — **`message` is optional.**
