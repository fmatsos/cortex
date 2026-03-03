# Cortex MCP Tools Reference

All tools are prefixed with `cortex_`. The MCP server must be running and configured
(via `.mcp.json` or equivalent). See the main SKILL.md for when and why to use each.

---

## Core CRUD

### `cortex_search` — Find memories semantically

```json
{
  "query": "JWT authentication timeout",
  "top_k": 5,
  "min_score": 0.5,
  "level": "semantic",
  "session_id": "optional-for-working-filter",
  "include_obsolete": false
}
```
- **Required**: `query`
- `level`: `"working"` | `"episodic"` | `"semantic"` — omit to search all layers
- Default `top_k: 5`, `min_score: 0.5` — don't lower score below 0.4

---

### `cortex_create` — Create a memory directly

```json
{
  "title": "JWT refresh fails with 401 when token nears expiry",
  "content": "Root cause: server rejects tokens with < 5s remaining. Fix: refresh 30s before expiry in the client interceptor. File: internal/auth/interceptor.go",
  "level": "episodic",
  "tags": ["auth", "jwt", "bug"],
  "source": "llm",
  "session_id": "my-session-123"
}
```
- **Required**: `title`, `content`, `level`
- `source`: set `"llm"` when the agent creates the memory
- `session_id`: required for `level: "working"`

---

### `cortex_consolidate` — Create with smart deduplication

Preferred over `cortex_create` when you're not sure if the memory already exists.
Automatically detects duplicates and merges similar memories.

```json
{
  "synthesis": "Full content of what you want to remember...",
  "memory_level": "episodic",
  "context": {
    "session_id": "my-session-123",
    "tags": ["architecture", "go"],
    "source": "llm",
    "related_memories": ["memory-id-1"]
  },
  "force": false
}
```
- **Required**: `synthesis`, `memory_level`
- `memory_level`: use `"working"` (with `session_id`) during a session, `"episodic"` for events/decisions, `"semantic"` only for confirmed durable patterns via maintenance
- `force: true` bypasses duplicate check

---

### `cortex_list` — Browse all memories

```json
{
  "level": "working",
  "session_id": "my-session-uuid",
  "include_obsolete": false
}
```
- `level`: `"working"` | `"episodic"` | `"semantic"` — omit for all layers
- `session_id`: filters working memories to the current session (use `cortex session id` to get it)

---

### `cortex_get` — Get a specific memory by ID

```json
{ "id": "40345677-6795-4b4c-aab6-437e6d23ad76" }
```

---

## Lifecycle Tools

### `cortex_promote_memory` — Promote to a higher layer

Use when an episodic memory has become general knowledge (episodic → semantic),
or a working memory is worth keeping beyond the session (working → episodic).

```json
{
  "memory_id": "abc123",
  "revised_title": "Optional improved title",
  "revised_content": "Optional revised content for the promoted copy",
  "tags": ["architecture", "patterns"]
}
```

---

### `cortex_update_memory` — Fix or improve a memory in place

```json
{
  "memory_id": "abc123",
  "title": "New title",
  "content": "Updated content with corrections...",
  "tags": ["updated", "tags"]
}
```
Re-generates embedding when title or content change.

---

### `cortex_mark_obsolete` — Soft-delete an outdated memory

Preferred over hard deletion — obsolete memories are hidden from search but
preserve history for auditing.

```json
{
  "memory_id": "abc123",
  "reason": "Replaced by new architecture in refactor-2026"
}
```

---

## Thinking / Reflection Tools

These tools return a **prompt** — a structured question for you to answer.
After calling them, read the returned text and act on its guidance.

### `cortex_review_session` — End-of-session review

Call at the end of every working session. Fetches all working memories for
the session and returns a prompt asking: promote, mark obsolete, or leave.

```json
{
  "session_id": "my-session-123",
  "task_summary": "Implemented lazy OllamaEmbedder to fix MCP server timeout"
}
```

---

### `cortex_think_about_task_completion` — Post-task reflection

Call after completing any significant task. Returns a prompt to capture:
what was learned, decisions made, knowledge worth recording.

```json
{
  "task_description": "Migrated MCP server from custom implementation to mcp-go library",
  "outcome": "All tests pass, timeout issue resolved, 13 tools split into individual files",
  "session_id": "optional",
  "related_memory_ids": ["abc123"]
}
```

---

### `cortex_think_about_memory_maintenance` — Periodic health check

Call occasionally (e.g., weekly or when memory feels cluttered). Returns a
prompt with statistics and samples, asking you to identify: obsolete memories,
episodic memories ready to promote, related memories to merge.

```json
{
  "focus_level": "episodic",
  "focus_tags": ["bug", "auth"]
}
```
Both parameters are optional.

---

## Decision Helper Tools

### `cortex_choose_memory_layer` — Get guidance on which level to use

When unsure whether something is working/episodic/semantic, call this and
follow its guidance.

```json
{
  "content": "The text of what you're about to store",
  "session_id": "optional"
}
```

---

### `cortex_choose_working_consolidation` — Select which working memories to consolidate

Call when you have many working memories and want to decide which ones to
promote or consolidate before a session ends.

```json
{
  "working_memories": [
    { "id": "abc", "title": "...", "content": "..." }
  ],
  "selection_goal": "Prepare end-of-session consolidation"
}
```

---

## Typical Workflows

### New task (2 calls)
```
1. cortex_search({ query: "relevant topic" })
2. cortex_search({ query: "related area", level: "semantic" })
→ Read results, then start working with that context
```

### Store a lesson (1 call)
```
# Always store new events/decisions as episodic first
cortex_consolidate({
  synthesis: "...",
  memory_level: "episodic",
  context: { source: "llm", tags: [...] }
})
# Only use memory_level: "semantic" for patterns confirmed by multiple episodic memories,
# via cortex_think_about_memory_maintenance — not inline during task work.
```

### End of session (2–3 calls)
```
1. cortex_review_session({ session_id: "...", task_summary: "..." })
   → Read returned prompt, promote working memories to episodic (NEVER directly to semantic)
2. cortex_think_about_task_completion({ task_description: "...", outcome: "..." })
   → Read returned prompt, create recommended episodic memories
3. [periodic] cortex_think_about_memory_maintenance()
   → Only when called explicitly; promotes episodic → semantic when there is enough backing
```
