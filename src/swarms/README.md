# Swarms module

Multi-agent orchestration (AgentWorker + SwarmGraph + runtime).

- **Architecture:** [`docs/SWARMS.md`](../../docs/SWARMS.md)
- **Agent I/O contracts:** [`docs/SWARMS-AGENT-IO.md`](../../docs/SWARMS-AGENT-IO.md)
- **HTTP API:** [`docs/SWARMS-API.md`](../../docs/SWARMS-API.md)
- **Workspace UI (frontend):** [`docs/SWARMS-WORKSPACE.md`](../../docs/SWARMS-WORKSPACE.md)
- **LLM inference:** [`docs/INFERENCE.md`](../../docs/INFERENCE.md)

| Folder | Role |
|--------|------|
| `schemas/` | Mongoose models (`agent_workers`, `swarms`, `swarm_graphs`, `swarm_runs`, `agent_runs`) |
| `context/` | `SwarmContext` — shared state per execution |
| `orchestrator/` | `SwarmOrchestratorService`, `resolveWorkerInput`, LLM executor |
| `services/` | Data access (`admin*` methods for cross-tenant ops) |
| `controllers/` | User routes + `admin/swarms`, `admin/agent-workers` |
| `types/` | Shared enums |
