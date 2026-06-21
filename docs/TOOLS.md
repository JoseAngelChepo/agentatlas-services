# Tools — agent functions & platform integrations

How **agentatlas-services** exposes callable tools to LLM workers during swarm runs, and how that differs from the **platform integration catalog** (Gmail, Slack, Apollo, …).

**Related:** [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md) (worker fields), [`INFERENCE.md`](./INFERENCE.md) (tool loop), [`SWARMS-API.md`](./SWARMS-API.md) (HTTP), [`SWARMS.md`](./SWARMS.md) (sub-swarm graph nodes).

---

## Table of contents

1. [Two concepts](#two-concepts)
2. [Architecture](#architecture)
3. [Agent tools (`agentTools`)](#agent-tools-agenttools)
4. [Swarm tools (`swarmTools`)](#swarm-tools-swarmtools)
5. [Connected tools prompt block](#connected-tools-prompt-block)
6. [`run_swarm` vs `swarmTools`](#run_swarm-vs-swarmtools)
7. [HTTP API](#http-api)
8. [Inference runtime](#inference-runtime)
9. [Adding a new agent tool](#adding-a-new-agent-tool)
10. [Platform integrations catalog](#platform-integrations-catalog)
11. [Workspace UI](#workspace-ui)

---

## Two concepts

| Concept | Worker field | Runtime | Purpose |
|---------|--------------|---------|---------|
| **Agent tools** | `agentTools: string[]` | OpenAI function calling during inference | Built-in platform actions (`webpage_scrape`, `run_swarm`, …) |
| **Swarm tools** | `swarmTools: string[]` | Dynamic OpenAI functions per swarm id | Run another swarm as a sub-run from a worker |
| **Platform integrations** | *(not on worker)* | Prompt context + future Open Claw dispatch | User-connected apps (Gmail, HubSpot, …) for `{{runInput.toolsAvailable}}` |

Agent and swarm tools are merged into the worker’s OpenAI `functions` list by `LlmWorkerExecutorService`. Platform integrations are a separate catalog stored in `user_tool_connections` and surfaced in run input enrichment — see [Platform integrations catalog](#platform-integrations-catalog).

---

## Architecture

```text
AgentWorker
  ├── agentTools[]     ──► ToolRegistryService ──► OpenAI function defs
  └── swarmTools[]     ──► SwarmAsToolService  ──► swarm_<objectId> defs
                                    │
                                    ▼
                         SwarmOrchestratorService.runSwarmAsAgentTool()
                                    │
                                    ▼
                         Sub-swarm run (linked to parent swarm_run)
```

| Component | Path |
|-----------|------|
| Module | `src/tools/` |
| Registry | `src/tools/registry/tool-registry.service.ts` |
| Base class | `src/tools/base/base-agent.tool.ts` |
| Swarm-as-tool | `src/swarms/services/swarm-as-tool.service.ts` |
| Tool loop wiring | `src/swarms/orchestrator/llm-worker-executor.service.ts` |
| OpenAI merge | `src/tools/utils/merge-agent-tools-into-openai-config.ts` |
| Tools prompt block | `src/tools/utils/build-worker-tools-prompt-block.ts` |
| `run_swarm` dedup | `src/tools/utils/split-registry-agent-tool-ids.ts` (`shouldExposeRunSwarmTool`) |

Registered agent tools use NestJS multi-providers (`registerAgentTool()` in `tools.module.ts`). Swarm tools are resolved dynamically from `worker.swarmTools` at inference time.

---

## Agent tools (`agentTools`)

Optional list on **`agent_workers`**. Each id becomes an OpenAI **function tool** (Responses API) when the worker runs with `openai_direct` on `api.openai.com`.

### Worker configuration

```json
{
  "agentTools": ["webpage_scrape", "run_swarm"]
}
```

| Tool id | Name | Config required | Description |
|---------|------|-----------------|-------------|
| `webpage_scrape` | Webpage scrape | `FIRECRAWL_API_KEY` | Fetch a URL via Firecrawl; returns markdown in JSON |
| `web_search` | Web search | `FIRECRAWL_API_KEY` | Search the web and return results with markdown content |
| `research_search_papers` | Research — search papers | `FIRECRAWL_API_KEY` | Search academic papers by topic, author, or category |
| `research_paper` | Research — inspect/read paper | `FIRECRAWL_API_KEY` | Paper metadata or full-text passages for a question |
| `research_related_papers` | Research — related papers | `FIRECRAWL_API_KEY` | Expand from a seed paper (similar, citers, references) |
| `research_search_github` | Research — search GitHub | `FIRECRAWL_API_KEY` | Search GitHub issues, PRs, and READMEs |
| `run_swarm` | Run swarm | — | Execute any accessible swarm by id (see [whitelist](#whitelist)). Resolved by **`SwarmAsToolService`**, not `ToolRegistryService`. |

Catalog (including `configured` flag): `GET /inference/setup` → `agentTools.catalog`, or `GET /tools`.

### `webpage_scrape`

**Function parameters:**

```json
{
  "type": "object",
  "required": ["url"],
  "properties": {
    "url": { "type": "string", "description": "Full public URL including https://" }
  },
  "additionalProperties": false
}
```

**Direct API:** `POST /tools/webpage-scrape/run` with `{ "url": "https://..." }`.

Requires authenticated user context. During a swarm run, scrape requests are attributed to the swarm run (`ScrapeRequestSource.AGENT`).

Uses Firecrawl `POST /v2/scrape` (replaces the former Cloudflare Browser Run integration).

### `web_search`

Search the web and optionally scrape full-page markdown in one call (Firecrawl `POST /v2/search`).

**Function parameters:**

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 10 },
    "sources": { "type": "array", "items": { "enum": ["web", "news", "images"] } },
    "categories": { "type": "array", "items": { "enum": ["github", "research", "pdf"] } },
    "includeDomains": { "type": "array", "items": { "type": "string" } },
    "excludeDomains": { "type": "array", "items": { "type": "string" } },
    "country": { "type": "string" },
    "tbs": { "type": "string", "description": "Time filter, e.g. qdr:w for past week" }
  },
  "additionalProperties": false
}
```

**Direct API:** `POST /tools/web_search/run` with `{ "query": "..." }`.

### Research tools (Firecrawl Research Index)

Academic and engineering research via Firecrawl `GET /v2/search/research/*`:

| Tool id | Purpose |
|---------|---------|
| `research_search_papers` | Search paper abstracts (`query`, optional `authors`, `categories`, `from`/`to`) |
| `research_paper` | Inspect metadata by `paperId`, or read passages with optional `question` |
| `research_related_papers` | Expand from a seed `paperId` with `intent` and optional `mode` (`similar`, `citers`, `references`) |
| `research_search_github` | Search GitHub issues, PRs, discussions, and READMEs |

Example worker config for a research agent:

```json
{
  "agentTools": ["web_search", "research_search_papers", "research_paper", "research_related_papers"]
}
```

### `run_swarm`

Generic tool when the model should pick a swarm by id:

**Function parameters:**

```json
{
  "type": "object",
  "required": ["swarmId"],
  "properties": {
    "swarmId": { "type": "string", "description": "MongoDB id of the swarm to execute" },
    "input": { "type": "object", "description": "Optional child run input", "additionalProperties": true }
  },
  "additionalProperties": false
}
```

**Direct API:** `POST /tools/run_swarm/run` with `{ "swarmId": "...", "input": { ... } }`.

Prefer **`swarmTools`** (below) when the worker should only call specific swarms — each gets a dedicated function name and description.

If the worker lists **`swarmTools`** ids, `run_swarm` is **not** exposed at inference time (even when it remains in `agentTools`) — dedicated `swarm_<id>` functions are enough. Keep `run_swarm` only when you need the model to pick any accessible swarm by id and `swarmTools` is empty.

---

## Swarm tools (`swarmTools`)

Optional list of **swarm MongoDB ids** on the worker. At inference time each accessible swarm is exposed as:

```text
swarm_<24-char-hex-objectId>
```

Example: swarm id `674abc123def456789012345` → function name `swarm_674abc123def456789012345`.

### Worker configuration

```json
{
  "swarmTools": ["674abc123def456789012345", "674def456789012345678901"],
  "agentTools": ["webpage_scrape"]
}
```

You can combine `swarmTools` with other `agentTools` (e.g. `webpage_scrape`). When `swarmTools` is non-empty, `run_swarm` in `agentTools` is ignored at runtime — remove it from the worker config to avoid confusion in the workspace UI.

### Function schema

Each swarm tool accepts a free-form JSON object (passed as the **child swarm run input**):

```json
{
  "type": "object",
  "description": "Fields passed as the child swarm run input object",
  "additionalProperties": true
}
```

The **description** sent to the model includes the swarm name and goal/description from the swarm document.

### Runtime behavior

When the model calls a swarm tool during a parent swarm run:

1. **Access** — `SwarmAccessService.assertCanRun` (owner, hiring, or `platformRunnable`).
2. **Whitelist** — if `swarmTools` is non-empty on the worker, only listed ids are allowed (also applies to `run_swarm`).
3. **Parent link** — child run is created with `SwarmRunKind.SUB_SWARM`, `parentSwarmRunId`, and synthetic node id `agent-tool:swarm:<childSwarmId>`.
4. **User intent passthrough** — uses the child swarm **Start node input names** (`extractStartInputNames`). Matching keys copy from the parent run input; if the model sends `{}`, the parent's user text (`message`, `summary`, `task`, …) fills the **first** declared field (e.g. `task`).
5. **Nesting** — max depth `3` (`MAX_SWARM_NESTING_DEPTH`); circular swarm references are rejected.

### Tool call response (JSON string to the model)

```json
{
  "swarmRunId": "507f1f77bcf86cd799439011",
  "status": "done",
  "output": { "summary": "..." },
  "error": null
}
```

| `status` | Meaning |
|----------|---------|
| `done` | Child swarm finished; `output` is the exit node output |
| `failed` | Run failed (see `error`) |
| `paused` | Child paused for human input or approval |

On failure the executor returns `{ "error": "...", "tool": "<name>", "retryable": false }` instead of throwing.

### Whitelist

| Configuration | `run_swarm` | `swarm_<id>` |
|---------------|-------------|--------------|
| `swarmTools: []` (default) | Any swarm the user can run (if listed in `agentTools`) | *(none — add ids to `swarmTools`)* |
| `swarmTools: ["id1", "id2"]` | Omitted (use `swarm_<id>` instead) | One function per listed id |

Stale or inaccessible ids in `swarmTools` are skipped silently when building function definitions.

### vs graph sub-swarm node

| | Graph **Swarm** node | **Swarm tool** (agent function) |
|--|----------------------|----------------------------------|
| Trigger | Orchestrator traversal | LLM tool call mid-worker |
| Input mapping | `inputFields` / passthrough in graph UI | Model-supplied JSON args |
| Wiring | Fixed in graph | Declared on worker blueprint |
| Use case | Deterministic pipeline | Model decides when to delegate |

Both use the same sub-swarm execution path (`executeSubSwarm` / `runSwarmAsAgentTool`).

---

## Connected tools prompt block

When a worker has at least one executable function (`agentTools` and/or resolved `swarmTools`), the runtime appends a **Connected tools** section to the worker **Instructions** (`systemPrompt`) before calling the model.

| Piece | Path |
|-------|------|
| Collect specs | `collectWorkerToolPromptEntries()` in `src/tools/utils/build-worker-tools-prompt-block.ts` |
| Format markdown | `buildWorkerToolsPromptBlock()` |
| Append to system message | `buildWorkerChatMessages(..., { toolsPromptBlock })` in `src/inference/utils/build-worker-messages.ts` |
| Wired at run time | `LlmWorkerExecutorService` |

Each connected function gets four LLM-facing fields:

| Field | Source |
|-------|--------|
| **What it does** | Tool `description` (swarm name + goal for `swarm_<id>`) |
| **When to call** | `promptHints.whenToUse` on registry tools, or swarm-specific hints |
| **What to send** | **`swarm_<id>`:** child swarm **Start node** `inputVariables` from the graph in MongoDB (`extractStartInputNames`) — e.g. `{ "task": "…" }` not generic `message`. Example values come from the **parent** `swarm_run.input` when present. Registry tools use `promptHints.inputGuide` or schema fallback. |
| **Response** | `promptHints.outputGuide` or default JSON guidance |

**Swarm tool input contract:** loaded from `swarm_graphs` → Start node → `data.inputVariables[].name`. Same names as workspace `referencedSwarms[].inputs` and the OpenAI function JSON schema (`buildSwarmToolOpenAiParameters`). At execution time, `forwardChildSwarmRunInput` maps parent run text into the first declared field when the model sends `{}` or omits keys.

**Example appendix** (abbreviated):

```markdown
## Connected tools

You have function tools available for this run. When a user request matches a tool below, call that function first — do not guess or refuse without trying the tool.

### `swarm_<id>` — Agent Board (example)

**What it does:** Run swarm "Agent Board": Help the user with their request

**When to call:** When the user request should be handled by swarm "Agent Board" (fields: `"task"`).

**What to send:** This swarm expects run input fields: `"task"`. Call with `{"task":"Investigar empresas parecidas a notlabel.org"}`. Use `task` for the user's request — do not substitute `message` unless that is the declared field.

**Response:** JSON with `status`, `output`, `swarmRunId`…
```

The block appears in persisted `agent_runs.messages[0]` (system) and in workspace run debug output. It is **not** stored on the worker document — it is computed per run from the worker’s tool config.

To customize guidance for a new registry tool, add `promptHints` on the `BaseAgentTool` implementation — see [Adding a new agent tool](#adding-a-new-agent-tool).

---

## `run_swarm` vs `swarmTools`

Two ways to let a worker call child swarms as OpenAI functions:

| Mechanism | When to use |
|-----------|-------------|
| **`swarmTools: ["<id>", …]`** | Fixed set of child swarms — each becomes `swarm_<objectId>` with a descriptive function name |
| **`agentTools: ["run_swarm"]`** | Model must pick **any** accessible swarm by MongoDB id at runtime |

**Deduplication rule:** when `swarmTools` is **non-empty**, generic `run_swarm` is **not** exposed — even if it remains in `agentTools`. Implementation: `shouldExposeRunSwarmTool()` in `src/tools/utils/split-registry-agent-tool-ids.ts`.

```typescript
// Omitted when swarmToolIds.length > 0
shouldExposeRunSwarmTool(includesRunSwarm, swarmToolIds)
```

| Worker config | Functions at inference | Connected tools block |
|---------------|------------------------|------------------------|
| `agentTools: ["run_swarm"]`, `swarmTools: []` | `run_swarm` | Includes `run_swarm` section |
| `swarmTools: ["id1"]`, `agentTools: []` | `swarm_id1` | Includes `swarm_id1` only |
| Both `run_swarm` and `swarmTools: ["id1"]` | `swarm_id1` only | `run_swarm` section omitted |

The workspace UI strips redundant `run_swarm` on save when sub-swarms are listed — see [Workspace UI](#workspace-ui) and **`agentatlas-platform/docs/SWARMS-TOOLS.md`**.

---

## HTTP API

All routes require **`JwtAuthGuard`** + role **`user`**. Base: `/api/v1/tools`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tools` | Registered agent tools + `configured` + `inputSchema` |
| `GET` | `/tools/catalog` | Platform tool catalog for `{{runInput.toolsAvailable}}` |
| `GET` | `/tools/integrations` | Integration definitions + user connection status |
| `POST` | `/tools/integrations/:platformToolKey/connect` | Mark integration connected |
| `DELETE` | `/tools/integrations/:platformToolKey/connect` | Disconnect |
| `POST` | `/tools/webpage-scrape/run` | Run scrape directly |
| `POST` | `/tools/:id/run` | Run any registered agent tool (`webpage_scrape`, `run_swarm`, …) |

**Example — list tools:**

```bash
curl -s http://localhost:3001/api/v1/tools \
  -H "Authorization: Bearer TOKEN"
```

**Example — run swarm as tool (standalone, no parent run):**

```bash
curl -s -X POST http://localhost:3001/api/v1/tools/run_swarm/run \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "swarmId": "674abc123def456789012345",
    "input": { "topic": "Q4 planning" }
  }'
```

---

## Inference runtime

Flow in `LlmWorkerExecutorService`:

1. Parse `worker.agentTools` → `ToolRegistryService.resolveOpenAiFunctions()`.
2. Parse `worker.swarmTools` → `SwarmAsToolService.resolveFunctionDefinitions()`.
3. Apply `shouldExposeRunSwarmTool()` — omit `run_swarm` when `swarmTools` is non-empty.
4. Merge into `openaiTools.functions` (dedupe by name).
5. Build a **Connected tools** appendix (`buildWorkerToolsPromptBlock`) and append it to the worker Instructions system message — one section per connected function (what it does, when to call, args to send, how to use the response). See [Connected tools prompt block](#connected-tools-prompt-block).
6. If any functions exist, pass `onToolCall` to `InferenceProviderService.streamChatCompletion`.
7. Route calls: swarm function names → `SwarmAsToolService`; otherwise → `ToolRegistryService`.

**Requirements for function calling:**

- Worker `model.provider`: `openai_direct` (official API).
- OpenAI Responses API path (same as `webSearch` hosted tools).
- Worker must list tools in `agentTools` and/or `swarmTools`.

Tool context passed to executors:

```ts
{
  userId: string;           // swarm run triggeredBy
  swarmRunId?: string;      // parent run (sub-swarm link)
  agentRunId?: string;
  allowedSwarmToolIds?: string[];  // from worker.swarmTools
}
```

Setup metadata: `GET /inference/setup` includes `agentTools` and `swarmTools` sections for the workspace UI.

---

## Adding a new agent tool

1. Add id to `ToolId` enum (`src/tools/types/tool-id.enum.ts`).
2. Create `src/tools/types/<name>.types.ts` (input/output types).
3. Create `src/tools/implementations/<name>.tool.ts` extending `BaseAgentTool`.
4. Register in `src/tools/tools.module.ts`:

   ```typescript
   ...registerAgentTool(MyNewTool),
   ```

   **`run_swarm` is special:** it is not registered in the tool registry (avoids a circular dependency with `SwarmsModule`). It is implemented in `SwarmAsToolService` and enabled via `agentTools: ["run_swarm"]`.

5. Document the id in this file and enable on workers via `agentTools: ["my_new_tool"]`.

**`BaseAgentTool` contract:**

| Member | Purpose |
|--------|---------|
| `id` | OpenAI function name (matches `ToolId`) |
| `name` / `description` | Catalog + model-facing description |
| `inputSchema` | JSON Schema (`ToolInputSchema`, strict when possible) |
| `promptHints` | Optional `{ whenToUse, inputGuide, outputGuide }` — auto-appended to Instructions when the tool is on the worker |
| `isConfigured()` | Whether env/deps are ready |
| `execute(input, context?)` | Implementation; use `requireUserId()` when auth is required |

**Example skeleton:**

```typescript
@Injectable()
export class MyTool extends BaseAgentTool<MyInput, MyOutput> {
  readonly id = ToolId.MY_TOOL;
  readonly name = 'My tool';
  readonly description = '...';
  readonly promptHints = {
    whenToUse: 'When the user needs …',
    inputGuide: 'Call with `{ "field": "..." }`.',
    outputGuide: 'JSON with … — use it in your reply.',
  };
  readonly inputSchema: ToolInputSchema = { type: 'object', ... };

  isConfigured(): boolean { return true; }

  async execute(input: MyInput, context?: ToolExecutionContext): Promise<MyOutput> {
    this.requireUserId(context);
    // ...
  }
}
```

Swarm-as-tool logic stays in `SwarmAsToolService` — do not register swarms in `ToolRegistryService`.

---

## Platform integrations catalog

Separate from agent/swarm tools. Defined in `src/tools/platform-tool.registry.ts` (Gmail, Slack, Apollo, Web Search, …).

| Concern | Agent / swarm tools | Platform integrations |
|---------|---------------------|------------------------|
| Storage | Worker blueprint | `user_tool_connections` |
| Prompt token | — | `{{runInput.toolsAvailable}}`, `{{runInput.toolsAvailables}}` |
| HTTP | `/tools`, `/tools/:id/run` | `/tools/catalog`, `/tools/integrations` |
| Runtime today | OpenAI function loop | Catalog + connection status; dispatch via Open Claw (future) |

See [`SWARMS-AGENT-IO.md`](./SWARMS-AGENT-IO.md#run-input) for prompt variables.

---

## MongoDB

| Collection | Purpose |
|------------|---------|
| `agent_workers.agentTools` | Enabled registry tool ids |
| `agent_workers.swarmTools` | Swarm ids exposed as `swarm_<id>` functions |
| `user_tool_connections` | Per-user platform integration connections |

---

## Workspace UI

Implemented in **`agentatlas-platform`** (Configure agent panel → **Tools**). Platform doc: **`agentatlas-platform/docs/SWARMS-TOOLS.md`**.

| UI | API fields | Notes |
|----|------------|-------|
| **Tools** (+ menu) | `openaiTools`, `agentTools` | Web search (hosted), `webpage_scrape`, `run_swarm` from `GET /inference/setup` → `agentTools.catalog` |
| **Sub-swarms** | `swarmTools` | Picker from workspace `referencedSwarms`; each row shows `swarm_<id>` function name |
| Save | `PATCH /agent-workers/:id` | `agentToolsForSave()` drops redundant `run_swarm` when `swarmTools` is non-empty |

Requires worker `model.provider: openai_direct`. Sub-swarm and platform tools use OpenAI Responses function calling — same path as hosted web search.

---

## Checklist (workspace UI)

- [x] Multi-select for `agentTools` from `GET /inference/setup` → `agentTools.catalog`.
- [x] Picker for `swarmTools` from workspace `referencedSwarms`.
- [x] Show `configured: false` warnings for tools missing env (e.g. scrape) via catalog.
- [x] Sub-swarms section always visible on OpenAI Direct workers (no need to enable `run_swarm` first).
- [x] Visual hint when `run_swarm` is redundant (`Not used at runtime` badge; stripped on save).
- [ ] Preview assembled Instructions + Connected tools block before run (optional enhancement).
