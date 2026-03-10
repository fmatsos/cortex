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
- New MCP tool: `cortex_summarise_working` — takes all working memories for a session, calls the LLM (via configurable model), returns a compact summary.
- Triggered explicitly by the agent at session end (not automatic — keeps Cortex's explicit-control posture).
- Optional integration into `cortex_review_session` as a pre-step.
- Summary stored as a new episodic memory with `Source: "llm"` and `MergedFrom` pointing to the working memory IDs.

**Implementation notes:**
- New package: `internal/summarisation/service.go`
- New MCP tool handler: `internal/mcp/tool_summarise_working.go`
- Configurable prompt in `internal/config/config.go` (`summarisation.prompt_template`)
- Embedder already handles the resulting episodic memory

**Acceptance criteria:**
- `cortex_summarise_working` is callable from Claude Code / Cursor.
- Summary is stored as an episodic memory with correct lineage.
- Configurable prompt allows customisation without code changes.
- Token savings measurable by comparing `list --level working` before/after.

**Estimated effort:** Medium (3–5 days)
**Risk:** Requires an LLM call (Ollama or external); must be opt-in.

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

### 3.2 Web Viewer (Minimal)

**Motivation:** Claude-Mem's web UI at `localhost:37777` gives users a visual window into memories. Cortex is CLI-only today, which limits accessibility.

**Scope (minimal viable):**
- New subcommand: `cortex start-web` — starts an embedded HTTP server.
- Pages: memory list, memory detail, search bar.
- Static HTML served from embedded Go filesystem (`embed.FS`).
- No JavaScript framework — plain HTML + CSS + vanilla JS for search.
- Read-only initially (no create/edit from web UI in v1).

**Implementation notes:**
- New package: `internal/web/`
- New CLI command: `internal/cli/web.go`
- Static assets embedded via `//go:embed` — keeps single-binary property.
- Reuses existing `memory.Service` for all data queries.
- Default port: `3777` (configurable via `--port` flag / `CORTEX_WEB_PORT`).

**Acceptance criteria:**
- `cortex start-web` serves a page listing all memories.
- Search bar performs semantic search and shows results.
- Memory detail page shows full content, level, tags, timestamps.
- No external JS dependencies (no npm, no CDN).
- Binary size increase < 500 KB.

**Estimated effort:** Medium (3–5 days)
**Risk:** Medium — UI scope can expand; must be disciplined about v1 features.

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

**Motivation:** Claude-Mem's automatic context injection (via `UserPromptSubmit` hook) and session tracking (`SessionStart` / `SessionEnd`) reduce agent friction significantly. Cortex agents must manually call `cortex_search` to get context.

**Scope (minimal viable):**
- New `SessionStart` hook handler: on session start, load relevant working memories for the current session and write a context summary to `$CLAUDE_CONTEXT_FILE` (Claude Code hook contract).
- New `SessionEnd` hook handler: trigger `cortex_review_session` equivalent — summarise and transfer working memories.
- Hooks remain opt-in; agents not using Claude Code are unaffected.

**Out of scope for v1:**
- `PostToolUse` automatic observation capture (automatic capture conflicts with Cortex's explicit-control philosophy).
- Cursor integration (follow after Claude Code is validated).

**Implementation notes:**
- New CLI command: `cortex hooks install-claude-code` — writes hook scripts to `.claude/hooks/`.
- Hook scripts call `cortex session id` to get deterministic session ID from git branch.
- `SessionEnd` hook calls `cortex transfer-working --session <id>` + optional summarisation.
- No changes to core memory service — hooks are thin wrappers.

**Acceptance criteria:**
- After `cortex hooks install-claude-code`, session start loads prior context automatically.
- Session end transfers working memories without manual agent intervention.
- Hooks are idempotent (re-running `install-claude-code` is safe).
- Works with Claude Code ≥ current version.

**Estimated effort:** Medium (3–5 days)
**Risk:** Medium — Claude Code hook API may evolve; test against current version explicitly.

---

## 5. Tier 3 — Infrastructure (Q4 2026)

> **Theme:** Scale and polish for production environments.

### 5.1 REST API

**Motivation:** Claude-Mem exposes a full HTTP REST API, allowing external tooling, dashboards, and integrations. Cortex exposes MCP (stdio/SSE) only.

**Scope:**
- Extend `cortex start-web` to also serve a JSON REST API under `/api/v1/`.
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
  summarisation-tool.md
  token-aware-search.md
  timeline-tool.md
  privacy-tags.md
  web-viewer.md
  sqlite-backend.md
  ide-lifecycle-hooks.md
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
| 2026-03-10 | Web UI read-only in v1 | Scope control; write operations are well-served by CLI and MCP |
| 2026-03-10 | FTS5 search deferred to Tier 2 | Requires SQLite backend as prerequisite; tackle after backend lands |
| 2026-03-10 | Prioritise Summarisation + Token Awareness (Tier 1A) | Lower effort, high token-efficiency ROI; no storage changes required |
| 2026-03-10 | Prioritise Web UI + Privacy (Tier 1B) in parallel | UX and safety improvements are independent of storage changes |

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
