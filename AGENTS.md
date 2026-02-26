# Cortex – Agent Notes

**Module:** `github.com/cortex-ai/cortex-ai` · **Go 1.24+** · **Cobra / Viper / Ollama / Gob**

Three-layer memory system: `working` (session) → `episodic` (historical) → `semantic` (permanent).

---

## Golden Rules

1. **fmt → lint → test → build** before every commit — no exceptions.
   ```
   make fmt && make lint && make test && make build
   ```
2. **Never skip a failing step.** Fix it, restart from step 1.
3. **Keep MCP tool names stable** — renaming breaks integrations.
4. **golangci-lint: keep version 2** in the config file.
5. **Return errors; never print from library packages.**
6. **Stderr for errors, stdout for data.**
7. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.

---

## Documentation Index

Read only what the current task requires.

| Context | Read |
|---------|------|
| Build, test, lint, env vars | [`docs/agent/workflow.md`](docs/agent/workflow.md) |
| Code style, naming, error handling | [`docs/agent/conventions.md`](docs/agent/conventions.md) |
| Adding commands / MCP tools / memory levels | [`docs/agent/tasks.md`](docs/agent/tasks.md) |
| CLI commands reference | [`docs/cli/reference.md`](docs/cli/reference.md) |
| MCP integration & tool list | [`docs/cli/mcp.md`](docs/cli/mcp.md) |
| Memory model & three-layer design | [`docs/architecture/memory-model.md`](docs/architecture/memory-model.md) |
| Storage internals (Gob) | [`docs/architecture/storage.md`](docs/architecture/storage.md) |
| Embeddings & Ollama | [`docs/architecture/embeddings.md`](docs/architecture/embeddings.md) |
| System architecture | [`docs/architecture/overview.md`](docs/architecture/overview.md) |
| Configuration reference | [`docs/guides/configuration.md`](docs/guides/configuration.md) |
| Troubleshooting | [`docs/guides/troubleshooting.md`](docs/guides/troubleshooting.md) |
| Contributing & dev setup | [`docs/contributing/development.md`](docs/contributing/development.md) |

Full docs index: [`docs/INDEX.md`](docs/INDEX.md)
