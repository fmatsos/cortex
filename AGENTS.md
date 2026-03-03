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
2. **Never skip a failing step.** Fix it, restart from step 1.
3. **golangci-lint: use v2** (CI pins v2.10.1; install: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.10.1`)

### Code Quality

4. **Return errors; never print from library packages.**
5. **Stderr for errors, stdout for data.**
6. **CLI output via `cmd.OutOrStdout()`** — never use `fmt.Print*` in CLI commands; use `_, _ = fmt.Fprint*(cmd.OutOrStdout(), ...)`. The `errcheck` linter enforces this.
7. **No interface duplication** — use canonical interfaces (`memory.Embedder`, `storage.Storage`). The only accepted exception: the local storage interface in `memory/service.go` (breaks circular import). All other duplicates must be removed.
8. **Prefer `EmbedBatch` over repeated `Embed`** — for batch embedding operations, use `EmbedBatch` to avoid per-item round-trips to Ollama.

### Scope Discipline

9. **Keep MCP tool names stable** — renaming breaks integrations.
10. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.
11. **Test mocks must satisfy the full interface** — implement ALL methods of the interface being mocked, not just those exercised in the test. Missing methods cause compile errors when the interface evolves.

### Knowledge Capture

12. **Update AGENTS.md after every completed task** — Before closing a task, evaluate what you learned and apply **exactly one** of these two actions:
   - **New Golden Rule** — if the learning is critical, universal, and must always be enforced (e.g., a constraint that caused a bug or a pattern that must never be violated), add it as a new numbered rule under the appropriate group above.
   - **New or updated instruction** — if the learning is contextual, detailed, or scoped to a specific area (e.g., a new integration pattern, a debugging technique, a configuration guide), create or update a file in `.agents/instructions/` (docs/ symlinks are maintained automatically).
   - **Decision criteria:** ask yourself — *"Must every future task check this regardless of context?"* → Golden Rule. *"Is this useful only when working on a specific area?"* → Instruction file.
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

1. **Check Golden Rules** — note which rules apply to the current task
2. **Search Cortex** — `cortex search "<task topic>" --json` to surface prior context
3. **Search code** — `grepai search "<intent>" --json --compact` to find relevant code
4. **Trace dependencies** — `grepai trace` if modifying or calling existing functions
5. **Do the work** — apply Golden Rules throughout
6. **Pre-commit self-check** — run rule 13 checklist
7. **Verify** — `make fmt && make lint && make test && make build`
8. **Store learnings** — `cortex create` for key decisions and findings
9. **Update AGENTS.md** — apply rule 12: add a Golden Rule or update an instruction file in `.agents/instructions/`
10. **Session end** — `cortex transfer-working --json` to promote working memories to episodic
