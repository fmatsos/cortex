# Cortex — Feature Roadmap

**Date:** 2026-03-10
**Derived from:** [claude-mem-comparison.md](claude-mem-comparison.md)
**Strategy:** Strategic adoption of Claude-Mem features that strengthen Cortex, not full parity.
**Guiding principle:** Every feature must be compatible with Cortex's core design constraints:
  - Single binary (no external runtime dependencies added to the default path)
  - Offline-first (local Ollama; no mandatory cloud APIs)
  - Explicit control (agents remain deliberate about memory management)
  - Pluggable architecture (`storage.Storage` and `memory.Embedder` interfaces remain clean)

---

## Table of Contents

1. [Strategic Goals](#1-strategic-goals)
2. [Tier 1A — Optimisation (Q2 2026)](#2-tier-1a--optimisation-q2-2026)
3. [Tier 1B — UX & Privacy (Q2 2026)](#3-tier-1b--ux--privacy-q2-2026)
4. [Tier 2 — Core Parity (Q3 2026)](#4-tier-2--core-parity-q3-2026)
5. [Tier 3 — Infrastructure (Q4 2026)](#5-tier-3--infrastructure-q4-2026)
6. [Out of Scope](#6-out-of-scope)
7. [Feature Designs](#7-feature-designs)
8. [Decision Log](#8-decision-log)
9. [How to Extend This Roadmap](#9-how-to-extend-this-roadmap)

---

## 1. Strategic Goals

### What We Are Building Toward

A memory system that offers:

| Quality | Description |
|---------|-------------|
| **Efficient** | Agents spend as few tokens as possible to retrieve relevant context |
| **Explicit** | Users and agents remain in control of what is remembered and when |
| **Safe** | Private data is never inadvertently exposed to search or AI tools |
| **Rich** | Three-layer model, reflection tools, and lineage tracking remain first-class |
| **Portable** | Single binary works offline; optional SQLite backend scales further |

### What We Are Not Building

- A Claude-Mem clone (automatic capture, Node.js runtime, Chroma DB)
- A cloud-connected memory service
- A system that injects context automatically without agent consent
- A memory system that removes user control in favour of automation

---

## 2. Tier 1A — Optimisation (Q2 2026)

> **Theme:** Reduce token overhead and improve retrieval quality without changing the user-facing model.

### 2.1 Automatic Summarisation Tool

**Motivation:** Claude-Mem generates AI summaries of captured content automatically, dramatically reducing redundancy and token overhead. Cortex has no automatic summarisation today.

**Scope:**
- New MCP tool: `cortex_summarise_working` — gathers all working memories for a session and returns a structured synthesis prompt for the agent to read and synthesise. **Thinking-prompt pattern** (same as `cortex_review_session`): Cortex makes no active LLM call; the agent uses its own reasoning to produce the summary.
- Triggered explicitly by the agent at session end (not automatic — keeps Cortex's explicit-control posture).
- Agent reads the returned prompt, synthesises, then calls `cortex_consolidate` or `cortex_create` with `level=episodic` to store the result.
- Configurable prompt template controls the synthesis instructions the agent receives.

**Implementation notes:**
- New MCP tool handler: `internal/mcp/tool_summarise_working.go`
- Configurable prompt template in `internal/config/config.go` (`summarisation.prompt_template`)
- Handler uses `text/template` to render the prompt with session memories; no separate service package needed
- Embedder handles the resulting episodic memory when the agent calls `cortex_consolidate`

**Acceptance criteria:**
- `cortex_summarise_working` is callable from Claude Code / Cursor.
- Tool returns a structured prompt containing the session's working memories; agent synthesises and stores episodic memory via `cortex_consolidate`.
- Configurable prompt template allows customisation without code changes.
- Token savings measurable by comparing `list --level working` before/after agent synthesis.

**Estimated effort:** Small–Medium (1–2 days)
**Risk:** Low — no active LLM call from Cortex; pure prompt-assembly pattern consistent with existing thinking tools.

---

### 2.2 Token-Aware Search Responses

**Motivation:** Claude-Mem's 3-layer progressive disclosure (compact → timeline → full) achieves ~10× token savings. Cortex currently returns full content in all search results.

**Scope:**
- Add `compact` flag to `cortex_search` MCP tool: returns only `id`, `title`, `score`, and `level` (no content / embedding).
- Add `cortex_get_batch` MCP tool: fetch full content for a list of IDs after the agent decides which ones are relevant.
- Optionally: report estimated token cost per result in the search response.

**Implementation notes:**
- Extend `SearchResult` struct with a `TokenEstimate int` field (optional, computed from `len(Content)/4`).
- Add `compact bool` option to `cortex_search` tool schema.
- New tool `cortex_get_batch` accepts `[]string` of IDs; reuses `storage.Get()` in a loop.
- No storage changes required.

**Acceptance criteria:**
- `cortex_search` with `compact: true` returns ≤ 150 tokens per result.
- `cortex_get_batch` returns full memories for a list of IDs in one call.
- Token estimate field is populated and documented.

**Estimated effort:** Small (1–2 days)
**Risk:** Low — purely additive to existing interfaces.

---

### 2.3 Timeline MCP Tool

**Motivation:** Claude-Mem's `timeline` tool retrieves memories *chronologically around* a given ID — useful for understanding debugging sequences and decision chains. Cortex has no equivalent.

**Scope:**
- New MCP tool: `cortex_timeline` — given a memory ID and a window size (N before, N after), returns memories sorted by `CreatedAt` within the same session.
- Optionally: filter by level or tags.

**Implementation notes:**
- New MCP handler: `internal/mcp/tool_timeline.go`
- Uses `storage.List()` with a `session_id` filter + in-memory sort by `CreatedAt`
- No storage schema changes required.

**Acceptance criteria:**
- `cortex_timeline(memory_id: "X", window: 5)` returns 5 memories before and after X by creation time.
- Results are ordered chronologically.
- Session scoping works correctly for working memories.

**Estimated effort:** Small (1 day)
**Risk:** Low — uses existing storage primitives.

---

## 3. Tier 1B — UX & Privacy (Q2 2026)

> **Theme:** Improve accessibility for non-CLI users and add data protection controls.

### 3.1 Privacy Tags (`<private>` Support)

**Motivation:** Claude-Mem supports `<private>` content tags to prevent sensitive data from appearing in search results. Cortex has no privacy model today — all memories are equally visible.

**Scope:**
- Add `Private bool` field to `memory.Memory`.
- Parse `<private>…</private>` blocks from content at creation time; set `Private = true`.
- Extend `SearchAllLayers` to exclude private memories by default (opt-in via `include_private` flag).
- Add `--private` flag to `cortex create` for explicit marking.
- Add `private` parameter to `cortex_search` MCP tool.

**Implementation notes:**
- Modify `internal/memory/types.go` — add `Private bool` field.
- Modify `internal/memory/service.go` — detect `<private>` in content; set flag.
- Modify `internal/storage/gob.go` — serialise `Private` field (backward-compatible Gob zero-value = false).
- Modify `cortex_search` tool schema — add `include_private bool` (default: `false`).
- Modify `internal/cli/search.go` — add `--include-private` flag.

**Acceptance criteria:**
- Memory with `<private>` in content is excluded from `cortex search` by default.
- Memory with `--private` flag is excluded from `cortex search` by default.
- `cortex search --include-private` reveals private memories.
- Private flag is preserved through export/import cycle.

**Estimated effort:** Small (1–2 days)
**Risk:** Low — additive field; Gob handles unknown fields gracefully.

---

### 3.2 TUI Memory Browser

**Motivation:** Claude-Mem's web UI gives users a visual window into memories. Cortex is CLI-only today, which limits discoverability. A terminal UI fits Cortex's single-binary, offline-first design better than a web server, requires no HTTP port, and works seamlessly in remote/SSH environments.

**Scope (minimal viable):**
- New subcommand: `cortex browse` — opens an interactive terminal UI (TUI) using Bubbletea.
- Views: scrollable memory list, full-content detail view, live search.
- Memory management: delete, toggle private/obsolete, export to Markdown.
- Multi-select for bulk delete and export.
- Read/write from v1 (CLI parity in TUI).

**Implementation notes:**
- New package: `internal/tui/` — Bubbletea model, list/detail/search view components.
- New CLI command: `internal/cli/browse.go`
- Dependencies: `github.com/charmbracelet/bubbletea`, `github.com/charmbracelet/lipgloss`, `github.com/charmbracelet/bubbles` (already used in `internal/tui/`).
- Reuses existing `memory.Service` for all data operations.

**Acceptance criteria:**
- `cortex browse` opens an interactive list of all memories.
- `/` toggles search mode; results update in real time.
- `Enter` opens full-content detail view; `b` returns to list.
- `d` deletes selected memory (with confirmation); `p` toggles private; `o` toggles obsolete.
- `e` exports selected memory (or multi-selection) to Markdown.
- No new HTTP server or port opened.

**Estimated effort:** Medium (4–6 days)
**Risk:** Medium — TUI scope can expand; must be disciplined about v1 key bindings and features.

---

## 4. Tier 2 — Core Parity (Q3 2026)

> **Theme:** Close the most important functional gaps that affect day-to-day agent workflows.

### 4.1 Full-Text Search (FTS5) via SQLite Backend

**Motivation:** Cortex currently only supports semantic (vector) similarity search. Claude-Mem uses SQLite FTS5 to find exact keywords — essential for searching function names, error messages, and variable names that do not cluster well in embedding space.

**Scope:**
- Add a new optional storage backend: `SQLiteStorage` implementing the existing `storage.Storage` interface.
- SQLite schema: `memories` table + FTS5 virtual table on `title || ' ' || content`.
- Hybrid search: `SearchAllLayers` performs parallel FTS5 + cosine similarity, merges results with a configurable weighting (e.g., 60% semantic, 40% BM25).
- Migration tool: `cortex migrate --to sqlite` reads all Gob memories and re-saves to SQLite.
- `cortex.yaml` backend selection: `storage.backend: sqlite` (default stays `gob`).

**Implementation notes:**
- New file: `internal/storage/sqlite.go`
- Dependency: `github.com/mattn/go-sqlite3` (CGo) or `modernc.org/sqlite` (pure Go, preferred)
- Modify `internal/config/config.go` — add `storage.backend` validation for `sqlite`.
- New CLI command: `cortex migrate --to sqlite [--dry-run]`
- FTS5 ranking: use SQLite's built-in `bm25()` function for keyword score.
- Merge strategy: `score = α·cosine + (1-α)·bm25_normalised` (α configurable).

**Acceptance criteria:**
- `cortex search "exact function name"` returns relevant results even with low cosine similarity.
- `storage.backend: sqlite` is validated and documented.
- Migration preserves all memory fields including `Embedding` (stored as `BLOB`).
- All existing tests pass against SQLite backend.
- Gob backend remains default (no breaking change).

**Estimated effort:** Large (7–10 days)
**Risk:** High — CGo (go-sqlite3) complicates cross-compilation; consider `modernc.org/sqlite`.

---

### 4.2 IDE Lifecycle Integration (Claude Code)

**Motivation:** Claude-Mem's automatic context injection (via `UserPromptSubmit` hook) and session tracking (`SessionStart` / `SessionEnd`) reduce agent friction significantly. Cortex already has `session-start.sh`, `session-stop.sh`, and `pre-compact.sh` hooks; this tier improves them and adds the missing `UserPromptSubmit` hook.

**Scope:**
- Improve existing `session-start.sh`: inject structured JSON (working + top semantic memories) as a formatted context block.
- Improve existing `session-stop.sh`: auto-transfer working memories even if agent forgets; skip review step when session is empty.
- New `UserPromptSubmit` hook (`user-prompt-submit.sh`): on every incoming prompt, run `cortex search --compact` against the prompt text and inject top-3 relevant memories. This is the key missing capability versus Claude-Mem.
- All hooks remain opt-in via `cortex hooks init`; agents not using Claude Code are unaffected.

**Out of scope for v1:**
- `PostToolUse` automatic observation capture (conflicts with explicit-control philosophy).
- Cursor integration (follow after Claude Code is validated).

**Implementation notes:**
- Modify `internal/cli/hooks.go` — extend `initHooksCmd` to generate all four scripts + updated `settings.json`.
- `UserPromptSubmit` hook uses `cortex search --compact` (requires Plan A1 compact flag) with `timeout 3s` to avoid blocking Claude Code on cold Ollama start.
- `settings.json` merge strategy: preserve any existing user hooks when regenerating.

**Acceptance criteria:**
- After `cortex hooks init`, session start injects structured working + semantic memory context.
- On each user prompt, top-3 relevant memories are injected (if any match above threshold).
- Session stop auto-transfers working memories without manual agent intervention.
- Hooks are idempotent (re-running `cortex hooks init` is safe).
- Works with Claude Code ≥ current version.

**Estimated effort:** Medium (3–5 days)
**Risk:** Medium — Claude Code hook API may evolve; `UserPromptSubmit` requires Plan A1 compact flag as prerequisite.

---

## 5. Tier 3 — Infrastructure (Q4 2026)

> **Theme:** Scale and polish for production environments.

### 5.1 REST API

**Motivation:** Claude-Mem exposes a full HTTP REST API, allowing external tooling, dashboards, and integrations. Cortex exposes MCP (stdio/SSE) only.

**Scope:**
- New subcommand: `cortex start-api` — starts a lightweight HTTP JSON API server.
- Endpoints mirroring CLI commands: `GET /memories`, `POST /memories`, `GET /memories/{id}`, `DELETE /memories/{id}`, `GET /search?q=...`.
- Authentication: none by default (localhost only); optional bearer token via config.

**Estimated effort:** Medium (3–5 days)

---

### 5.2 Storage Migration & Performance

**Motivation:** As datasets grow beyond 10 k memories, GobStorage's O(N·D) linear search becomes a bottleneck.

**Scope:**
- Benchmark GobStorage vs SQLiteStorage at 10 k / 50 k / 100 k memories.
- Evaluate HNSW (approximate nearest neighbour) for cosine search beyond 50 k memories.
- Introduce lazy index loading for GobStorage (reduces startup time for large datasets).

**Estimated effort:** Large (5–8 days)

---

### 5.3 Multi-Project Memory

**Motivation:** Claude-Mem scopes memories to `project` automatically. Cortex currently stores all memories in a single path (per-project if `CORTEX_STORAGE_PATH` is set, but no automatic project detection).

**Scope:**
- Automatic project detection from git remote URL (hash-based namespace).
- Cross-project search flag: `cortex search --all-projects`.

**Estimated effort:** Medium (3–4 days)

---

## 6. Out of Scope

| Feature | Reason |
|---------|--------|
| **Fully automatic tool-usage capture** | Conflicts with explicit-control philosophy; generates noise |
| **Automatic context injection on every prompt** | Risks stale context injection; agent must remain deliberate |
| **Chroma as primary vector DB** | Adds Python subprocess; conflicts with single-binary goal |
| **Cloud embedding APIs** | Conflicts with offline-first design; Ollama remains default |
| **Node.js / Bun runtime** | Architectural non-starter |
| **OpenClaw / chat feed integration** | Niche; not core memory functionality |
| **Multi-user / collaborative memory** | Out of scope for single-agent use case |

---

## 7. Feature Designs

Full design documents for each feature will be created in `docs/analysis/designs/` as implementation begins. Proposed file naming:

```
docs/analysis/designs/
  token-aware-search.md
  timeline-tool.md
  summarisation-tool.md
  privacy-tags.md
  tui-memory-browser.md
  sqlite-backend.md
  ide-lifecycle-hooks.md
  storage-performance.md
  multi-project-memory.md
  rest-api.md
```

---

## 8. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-10 | SQLite as optional backend, not default | Keeps single-binary for existing users; Go-only Gob avoids CGo complexity |
| 2026-03-10 | No automatic PostToolUse capture | Cortex's explicit-control model is a differentiator, not a limitation |
| 2026-03-10 | No Chroma integration | Python subprocess breaks single-binary deployment goal |
| 2026-03-10 | Summarisation is MCP tool, not automatic hook | Preserves agent control; agents decide when to summarise |
| 2026-03-10 | `cortex_summarise_working` uses thinking-prompt pattern, no active LLM call | Consistent with all existing thinking tools (`cortex_review_session`, etc.); Cortex does not call Ollama directly — agent reasons from the returned prompt |
| 2026-03-10 | TUI browser instead of web viewer (Tier 1B) | TUI fits single-binary, offline-first design; no HTTP port or embedded assets; works in SSH/remote environments; Charm/Bubbletea already in use |
| 2026-03-10 | IDE hooks: improve existing + add UserPromptSubmit, not build from scratch | Hooks (`session-start.sh`, `session-stop.sh`, `pre-compact.sh`) already exist; UserPromptSubmit is the key missing hook vs Claude-Mem |
| 2026-03-10 | Web UI read-only in v1 (superseded by TUI decision above) | Scope control; write operations are well-served by CLI and MCP |
| 2026-03-10 | FTS5 search deferred to Tier 2 | Requires SQLite backend as prerequisite; tackle after backend lands |
| 2026-03-10 | Prioritise Summarisation + Token Awareness (Tier 1A) | Lower effort, high token-efficiency ROI; no storage changes required |
| 2026-03-10 | Prioritise TUI Browser + Privacy (Tier 1B) in parallel | UX and safety improvements are independent of storage changes |

---

## 9. How to Extend This Roadmap

### Adding a New Feature

1. Open [claude-mem-comparison.md](claude-mem-comparison.md) and check if the feature exists in Claude-Mem (if relevant).
2. Add the feature to the appropriate Tier section above with:
   - **Motivation** — why this feature belongs in Cortex.
   - **Scope** — what is in and out of v1.
   - **Implementation notes** — which files to touch and what interfaces to extend.
   - **Acceptance criteria** — how to verify the feature is done.
   - **Estimated effort** — Small / Medium / Large.
   - **Risk** — any known gotchas.
3. Add a decision log entry explaining the priority choice.
4. Create a design document in `docs/analysis/designs/<feature>.md` before implementation.

### Reprioritising Features

1. Update the Tier assignment of the affected feature.
2. Add a new row to the [Decision Log](#8-decision-log) explaining the reason for the change.
3. Update the `roadmap.md` last-updated date.

### Completing a Feature

1. Move the feature to a "Completed" section at the bottom of the relevant Tier.
2. Add a link to the merged PR / commit hash.
3. Update [docs/INDEX.md](../INDEX.md) if new documentation was created.
4. Update [claude-mem-comparison.md](claude-mem-comparison.md) gap table to reflect the new status.
5. Store the key learnings in Cortex memory: `cortex create --level semantic --title "..." --content "..."`.

### Updating the Comparison

If Claude-Mem releases new features, re-run the analysis:

1. Fetch the latest Claude-Mem README: `curl https://raw.githubusercontent.com/thedotmack/claude-mem/main/README.md`
2. Scan for new features not covered in [claude-mem-comparison.md](claude-mem-comparison.md).
3. Add missing rows to the appropriate comparison tables.
4. Re-evaluate the gap list in Section 9 of the comparison doc.
5. Update this roadmap accordingly (new features → new Tier items or adjust priorities).

---

## Completed Features

*(Empty — roadmap created 2026-03-10)*

---

*Last updated: 2026-03-10*
*Owner: Cortex development team*
*Source analysis: [claude-mem-comparison.md](claude-mem-comparison.md)*
