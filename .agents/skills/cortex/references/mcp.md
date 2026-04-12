# Cortex MCP Tools Reference

All tools are prefixed `cortex_`. MCP server must be running (configured via `.mcp.json`).
For session workflows see `workflows.md`.

---

## Core CRUD

### `cortex_search`
```json
{ "query": "JWT authentication timeout", "top_k": 5, "min_score": 0.5,
  "level": "semantic", "session_id": "", "include_obsolete": false }
```
`level`: `"working"|"episodic"|"semantic"` — omit to search all · Don't lower `min_score` below 0.4

### `cortex_create`
```json
{ "title": "JWT refresh fails with 401 near expiry", "content": "Root cause: …",
  "level": "episodic", "tags": ["auth","bug"], "source": "llm", "session_id": "" }
```
`source: "llm"` when agent creates · `session_id` required for `level: "working"`

### `cortex_consolidate` — preferred; deduplicates automatically
```json
{ "synthesis": "Full content to remember…", "memory_level": "episodic",
  "context": { "session_id": "", "tags": ["arch","go"], "source": "llm" }, "force": false }
```
`force: true` bypasses duplicate check · Use `"working"` + `session_id` during active session

### `cortex_list`
```json
{ "level": "working", "session_id": "my-session-id", "include_obsolete": false }
```

### `cortex_get`
```json
{ "id": "40345677-6795-4b4c-aab6-437e6d23ad76" }
```
Prefix matching supported (first 8 chars usually enough).

---

## Lifecycle Tools

### `cortex_update_memory` — fix/improve in place (re-generates embedding)
```json
{ "memory_id": "abc123", "title": "New title", "content": "Updated…", "tags": ["new"] }
```

### `cortex_mark_obsolete` — soft-delete (preferred over hard delete)
```json
{ "memory_id": "abc123", "reason": "Replaced by new architecture in refactor-2026" }
```

### `cortex_promote_memory` — move to higher layer
```json
{ "memory_id": "abc123", "revised_title": "Optional improved title",
  "revised_content": "Optional revised content", "tags": ["patterns"] }
```
Episodic → semantic when pattern is confirmed. Working → episodic at session end.

### `cortex_demote_memory` — move to lower layer
```json
{ "memory_id": "abc123", "target_level": "episodic" }
```

---

## Relation Tools

### `cortex_link` — explicitly link two memories (bidirectional)
```json
{ "memory_id": "abc123", "related_id": "def456" }
```

### `cortex_get_related` — get relation graph
```json
{ "memory_id": "abc123", "include_lineage": true }
```

---

## Thinking / Reflection Tools

These return a **prompt** — read the returned text and act on its guidance.

### `cortex_review_session` — end-of-session review
```json
{ "session_id": "my-session-123", "task_summary": "Implemented lazy OllamaEmbedder" }
```
Fetches all working memories and asks: promote, mark obsolete, or leave.

### `cortex_think_about_task_completion` — post-task reflection
```json
{ "task_description": "Migrated MCP server to mcp-go", "outcome": "All tests pass",
  "session_id": "", "related_memory_ids": [] }
```

### `cortex_think_about_memory_maintenance` — periodic health check
```json
{ "focus_level": "episodic", "focus_tags": ["bug","auth"] }
```
Both params optional. Call occasionally, not after every task.

---

## Decision Helper Tools

### `cortex_choose_memory_layer` — which layer for this content?
```json
{ "content": "Text of what you're about to store", "session_id": "" }
```

### `cortex_choose_working_consolidation` — which working memories to consolidate?
```json
{ "working_memories": [{ "id": "abc", "title": "…", "content": "…" }],
  "selection_goal": "Prepare end-of-session consolidation" }
```
