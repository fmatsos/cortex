# Cortex – Agent Notes

**Package:** `cortex-memory` · **Python 3.12+** · **Typer / Pydantic / ChromaDB / Ollama / MCP**

Three-layer memory system: `working` (session) → `episodic` (historical) → `semantic` (permanent).

---

## Golden Rules

**IMPORTANT: These rules are NON-NEGOTIABLE. Verify compliance with EVERY applicable rule before submitting any code change. If you are unsure whether a rule applies, it applies.**

### Build & CI

1. **fmt → lint → test** before every commit — no exceptions.
   ```
   uv run ruff format src/ tests/ && uv run ruff check src/ tests/ && uv run pytest tests/
   ```
2. **Never skip a failing step.** Fix it, restart from step 1.
3. **ruff for linting and formatting** — configured in `pyproject.toml`. Run with `uv run ruff check` and `uv run ruff format`.

### Code Quality

4. **Raise exceptions from library code; never print.** CLI commands use `typer.echo()`, library code raises.
5. **Stderr for errors, stdout for data.** Use `typer.echo(..., err=True)` for error messages.
6. **All CLI output via typer.echo()** — never use `print()` in CLI commands.
7. **No Protocol duplication** — use canonical protocols (`cortex.embeddings.base.Embedder`, `cortex.storage.base.Storage`). Do not redeclare them in other modules.
8. **Prefer `embed_batch` over repeated `embed`** — for batch embedding operations, use `embed_batch()` to avoid per-item round-trips to Ollama.

### Storage Rules

9. **ChromaDB metadata is flat** — only `str`, `int`, `float`, `bool` are supported. Serialize lists with `json.dumps()`.
10. **Always close storage** — call `storage.close()` in a `finally` block or use a context manager.

### Scope Discipline

11. **Keep MCP tool names stable** — renaming breaks integrations (Claude Code, Cursor, etc.).
12. **Minimal changes** — don't refactor, add helpers, or clean up beyond what was asked.
13. **Test mocks must satisfy the full Protocol** — implement ALL methods of the Protocol being mocked.

### Knowledge Capture

14. **Update AGENTS.md after every completed task** — Before closing a task, evaluate what you learned and apply **exactly one** of these two actions:
   - **New Golden Rule** — if the learning is critical, universal, and must always be enforced.
   - **New or updated instruction** — if the learning is contextual or scoped to a specific area.
   - Never skip this step. Undocumented knowledge is lost knowledge.

### Pre-Commit Self-Check

15. **Verify before committing** — Before every commit, confirm:
   - No `print()` in CLI or library code (rules 4, 6)
   - No duplicated Protocols (rule 7)
   - All mock methods implemented (rule 13)
   - `embed_batch` used where applicable (rule 8)
   - `storage.close()` called in `finally` blocks (rule 10)
   - AGENTS.md updated if new knowledge was gained (rule 14)
   - `uv run ruff format && uv run ruff check && uv run pytest` passes (rule 1)

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
- File path patterns (e.g., `**/*.py`)

### Usage

```bash
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
```

---

## Cortex – Persistent Memory

**IMPORTANT: Always search Cortex memories BEFORE starting a task, and store what you learned AFTER completing it.**

### CLI Commands Reference

| Command                                                                           | When to use |
|-----------------------------------------------------------------------------------|-------------|
| `uvx --from . cortex search "<query>" --json`                                     | Find relevant context before starting a task |
| `uvx --from . cortex create --title "..." --level <level> --content "..." --json` | Store new facts, decisions, or findings |
| `uvx --from . cortex list [--level <level>] --json`                               | Browse memories by level |
| `uvx --from . cortex get <id> --json`                                             | Retrieve a specific memory by ID |
| `uvx --from . cortex delete <id>`                                                 | Permanently remove a memory |
| `uvx --from . cortex consolidate "<synthesis>" --level <level> --json`            | Synthesise related memories into one |
| `uvx --from . cortex transfer-working --json`                                     | Promote all working memories to episodic at session end |
| `uvx --from . cortex autoprune --json`                                            | Remove duplicate and expired memories |

---

## Task Workflow

**IMPORTANT: Follow this sequence for EVERY task. Do not skip steps.**

1. **Check Golden Rules** — note which rules apply to the current task
2. **Search Cortex** — `uvx --from . cortex search "<task topic>" --json` to surface prior context
3. **Search code** — `grepai search "<intent>" --json --compact` to find relevant code
4. **Trace dependencies** — `grepai trace` if modifying or calling existing functions
5. **Do the work** — apply Golden Rules throughout
6. **Pre-commit self-check** — run rule 15 checklist
7. **Verify** — `uv run ruff format src/ tests/ && uv run ruff check src/ tests/ && uv run pytest tests/`
8. **Store learnings** — `uvx --from . cortex create` for key decisions and findings
9. **Update AGENTS.md** — apply rule 14: add a Golden Rule or update an instruction file in `.agents/instructions/`
10. **Session end** — `uvx --from . cortex transfer-working --json` to promote working memories to episodic

### Configuration Notes

- Config lookup now falls back to `~/.config/cortex/config.toml` when `.agents/cortex/config.toml` is missing. Scaffold defaults with `uvx --from . cortex init --global` (or `--local` for the current project).
