# Cortex – Agent Notes

**Module:** `github.com/cortex-ai/cortex-ai` · **Go 1.24+** · **Cobra / Viper / Ollama / Gob**

Three-layer memory system: `working` (session) → `episodic` (historical) → `semantic` (permanent).

---

## Golden Rules

**IMPORTANT: These rules are NON-NEGOTIABLE. Verify compliance with EVERY applicable rule before submitting any code change. If you are unsure whether a rule applies, it applies.**

### Build & CI

1. **fmt → lint → test → build** before every commit — no exceptions.
   ```
   make fmt && make lint && make test && make build
   ```
   → Full target list: [`docs/agent/workflow.md`](docs/agent/workflow.md)
2. **Never skip a failing step.** Fix it, restart from step 1.
3. **golangci-lint: use v2** (CI pins v2.10.1; install: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.10.1`)

### Code Quality

4. **Return errors; never print from library packages.**
5. **Stderr for errors, stdout for data.**
6. **CLI output via `cmd.OutOrStdout()`** — never use `fmt.Print*` in CLI commands; use `_, _ = fmt.Fprint*(cmd.OutOrStdout(), ...)`. The `errcheck` linter enforces this.
   → CLI patterns: [`docs/agent/conventions.md`](docs/agent/conventions.md)
7. **No interface duplication** — use canonical interfaces (`memory.Embedder`, `storage.Storage`). The only accepted exception: the local storage interface in `memory/service.go` (breaks circular import). All other duplicates must be removed.
   → Canonical interfaces: [`docs/architecture/memory-model.md`](docs/architecture/memory-model.md)
8. **Prefer `EmbedBatch` over repeated `Embed`** — for batch embedding operations, use `EmbedBatch` to avoid per-item round-trips to Ollama.
   → Embedding details: [`docs/architecture/embeddings.md`](docs/architecture/embeddings.md)

### Scope Discipline

9. **Keep MCP tool names stable** — renaming breaks integrations.
10. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.
11. **Test mocks must satisfy the full interface** — implement ALL methods of the interface being mocked, not just those exercised in the test. Missing methods cause compile errors when the interface evolves.

### Knowledge Capture

12. **Update AGENTS.md after every completed task** — Before closing a task, evaluate what you learned and apply **exactly one** of these two actions:
   - **New Golden Rule** — if the learning is critical, universal, and must always be enforced (e.g., a constraint that caused a bug or a pattern that must never be violated), add it as a new numbered rule under the appropriate group above.
   - **New or updated documentation** — if the learning is contextual, detailed, or scoped to a specific area (e.g., a new integration pattern, a debugging technique, a configuration guide), create or update a doc in `docs/` and add a corresponding row to the Documentation Index table with the appropriate "Rules to enforce" mapping.
   - **Decision criteria:** ask yourself — *"Must every future task check this regardless of context?"* → Golden Rule. *"Is this useful only when working on a specific area?"* → Documentation + Index row.
   - Never skip this step. Undocumented knowledge is lost knowledge.

### Pre-Commit Self-Check

13. **Verify before committing** — Before every commit, confirm:
   - No `fmt.Print*` in CLI code (rule 6)
   - No duplicated interfaces (rule 7)
   - All mock methods implemented (rule 11)
   - `EmbedBatch` used where applicable (rule 8)
   - AGENTS.md updated if new knowledge was gained (rule 12)
   - `make fmt && make lint && make test && make build` passes (rule 1)

---

## Documentation Index

**IMPORTANT: You MUST consult this table BEFORE starting ANY task. Open and read every doc whose trigger matches your current task. Never assume you already know the content — always re-read.**

If no row clearly matches, read [`docs/INDEX.md`](docs/INDEX.md) to find the right doc.

| Your task involves                                 | Doc                                                                      | What you'll find                                                          | Rules to enforce |
|----------------------------------------------------|--------------------------------------------------------------------------|---------------------------------------------------------------------------|------------------|
| Running builds, writing tests, checking CI targets | [`docs/agent/workflow.md`](docs/agent/workflow.md)                       | `make` targets, env vars, test commands, benchmarks                       | 1, 2, 3          |
| Writing or reviewing Go code                       | [`docs/agent/conventions.md`](docs/agent/conventions.md)                 | Naming rules, error handling, concurrency, testing patterns, CLI patterns | 4, 5, 6, 7, 8    |
| Adding a CLI command, MCP tool, or memory level    | [`docs/agent/tasks.md`](docs/agent/tasks.md)                             | Step-by-step recipes for each extension point                             | 6, 9, 10, 11     |
| Fixing CLI help text, flags, or missing commands   | [`docs/cli/reference.md`](docs/cli/reference.md)                         | All commands, flags, examples                                             | 6, 9              |
| Configuring or debugging MCP server / tool list    | [`docs/cli/mcp.md`](docs/cli/mcp.md)                                     | Tool names, transport modes (stdio/SSE), client setup                     | 9                 |
| Understanding how memories flow between layers     | [`docs/architecture/memory-model.md`](docs/architecture/memory-model.md) | Three-layer design, `Memory` struct fields, lifecycle, decision tree      | 7                 |
| Debugging persistence or changing storage format   | [`docs/architecture/storage.md`](docs/architecture/storage.md)           | Gob file layout, serialisation, migration notes                           | 4, 10             |
| Changing embedding model, chunk size, or strategy  | [`docs/architecture/embeddings.md`](docs/architecture/embeddings.md)     | Ollama config, chunking strategies, vector dimensions                     | 8                 |
| Getting a first system-wide picture                | [`docs/architecture/overview.md`](docs/architecture/overview.md)         | Component diagram, data flow, tech stack                                  | —                 |
| Changing config keys, defaults, or env vars        | [`docs/guides/configuration.md`](docs/guides/configuration.md)           | All YAML/env keys with types and defaults                                 | 10                |
| Diagnosing a runtime error or startup failure      | [`docs/guides/troubleshooting.md`](docs/guides/troubleshooting.md)       | Common errors, debug steps, log locations                                 | —                 |
| Setting up or contributing to the dev environment  | [`docs/contributing/development.md`](docs/contributing/development.md)   | Dev setup, PR process, contribution guidelines                            | 1, 2              |
| Updating AGENTS.md after completing a task         | [`docs/contributing/knowledge-capture.md`](docs/contributing/knowledge-capture.md) | Decision criteria, examples of golden rules vs docs, index update process | 12                |
| None of the above / unsure which doc applies       | [`docs/INDEX.md`](docs/INDEX.md)                                         | Full docs index — browse to find the right doc                            | —                 |

### Documentation Lookup Rules

1. **Always scan before acting** — Before writing or modifying any code, scan every row. Open ALL docs that match, not just the first one.
2. **Multiple matches are normal** — A task like "add a new CLI command" matches at least `tasks.md`, `conventions.md`, and `reference.md`. Read all of them.
3. **Re-read if uncertain** — If you haven't read a matching doc in this session, or if your last read was for a different task, re-read it. Don't re-read docs you just consulted for the same task.
4. **No skipping by assumption** — If a row *might* match, read it. False positives cost seconds; false negatives cause bugs.
5. **Enforce linked rules** — After reading a doc, check the "Rules to enforce" column and verify compliance with each listed rule throughout your work.

Full docs index: [`docs/INDEX.md`](docs/INDEX.md)

---

## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

---

<!-- cortex-rules-start -->
## Cortex – Persistent Memory

**IMPORTANT: Always search Cortex memories BEFORE starting a task, and store what you learned AFTER completing it.**

### When to Use Cortex (REQUIRED)

Run `cortex` CLI commands proactively:

- **Before any non-trivial task** — run `cortex search` first to surface relevant context
- **After completing work** — store decisions, patterns, and findings
- **When making architectural decisions** — check for prior context
- **When debugging** — search for prior solutions to similar issues
- When the user mentions "remember", "store", "recall", or "what did we..."

### CLI Commands Reference

Always use the JSON output flag for machine-readable results.

| Command | When to use |
|---------|-------------|
| `cortex search "<query>" --json` | Find relevant context before starting a task |
| `cortex create --title "..." --level <level> --content "..." --json` | Store new facts, decisions, or findings |
| `cortex list [--level <level>] --json` | Browse memories by level |
| `cortex get <id> --json` | Retrieve a specific memory by ID |
| `cortex delete <id>` | Permanently remove a memory |
| `cortex consolidate "<synthesis>" --level <level> --json` | Synthesise related memories into one |
| `cortex transfer-working --json` | Promote all working memories to episodic at session end |
| `cortex autoprune --json` | Remove duplicate and expired memories |

### Memory Levels

| Level | Use for | Retention |
|-------|---------|-----------|
| `working` | Session context, active tasks, debug notes | Until transferred |
| `episodic` | Bug fixes, decisions, incidents, meetings | 90 days (default) |
| `semantic` | Conventions, patterns, architecture, best practices | Permanent |
<!-- cortex-rules-end -->

---

## Task Workflow

**IMPORTANT: Follow this sequence for EVERY task. Do not skip steps.**

1. **Scan Documentation Index** — match current task against triggers, open and read ALL matching docs
2. **Check Golden Rules** — note which rules apply (see "Rules to enforce" column)
3. **Search Cortex** — `cortex search "<task topic>" --json` to surface prior context
4. **Search code** — `grepai search "<intent>" --json --compact` to find relevant code
5. **Trace dependencies** — `grepai trace` if modifying or calling existing functions
6. **Do the work** — apply Golden Rules throughout, respect conventions from docs
7. **Pre-commit self-check** — run rule 12 checklist
8. **Verify** — `make fmt && make lint && make test && make build`
9. **Store learnings** — `cortex create` for key decisions and findings
10. **Update AGENTS.md** — apply rule 12: add a Golden Rule or create/update a doc + index row
11. **Session end** — `cortex transfer-working --json` to promote working memories to episodic
