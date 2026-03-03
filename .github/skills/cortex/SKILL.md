---
name: cortex
description: >
  Use Cortex to maintain persistent memory across sessions. Cortex is a
  three-layer memory system (working → episodic → semantic) enabling semantic
  search across everything you've learned.

  ALWAYS invoke this skill when:
  - Starting any non-trivial task — search for related memories FIRST before diving in
  - Finishing a task or session — record what was learned, decisions made, patterns found
  - About to make an architectural or design decision — check what was recorded before
  - Debugging something — search for prior solutions to similar issues
  - The user mentions "remember", "store", "memory", "cortex", "recall", or "what did we..."
  - You have cortex_* MCP tools available OR can run `cortex` in the terminal

  The goal is to be proactive — use Cortex as your own persistent brain.
  Don't wait to be asked. Search before acting, store after learning.
---

# Cortex Memory System

## Quick Habits (do these automatically)

| Moment | Action |
|--------|--------|
| **Task starts** | `cortex_search` / `cortex search "topic"` — what do I already know? |
| **Decision made** | Store the decision + rationale as **episodic** |
| **Bug fixed** | Store the fix, root cause, and symptoms as **episodic** |
| **Pattern found** | Store as **episodic** first; promote to semantic after it recurs |
| **Session ends** | Call `cortex_review_session` to promote worthy working memories |
| **Significant task done** | Call `cortex_think_about_task_completion` for a reflection prompt |

---

## The Three Memory Layers

```
Working   ──▶  Episodic  ──▶  Semantic
(session)       (events)       (knowledge)
```

| Layer | What goes here | Retention | Requires |
|-------|---------------|-----------|---------|
| **working** | Active task notes, current state, debug scratchpad | Session only (auto-expires) | `session_id` |
| **episodic** | Bug fixes, decisions made, experiments, "what happened" | 90 days (autoprune) | — |
| **semantic** | Conventions, patterns, architecture, "always true" knowledge | Forever | — |

**Decision rule:**
- Temporary during this session → **working**
- Specific event that happened → **episodic**
- General knowledge that'll stay true → **semantic**
- Not sure? → ask `cortex_choose_memory_layer` (MCP) for a guided prompt

---

## What to Store (and What Not To)

### ✅ Store these
- Bug root causes and their fixes
- Architecture decisions and the reasoning behind them
- Codebase conventions, patterns, naming rules discovered
- Configuration quirks, environment setup steps
- Recurring errors and solutions
- Important facts about the project (tech stack, key files, owners)
- Session summaries at the end of work

### ❌ Don't store these
- Information already in the code itself (read the code)
- Ephemeral data (file contents, logs) — summarize the lesson instead
- Duplicates of what's already in memory — search first!
- Sensitive credentials or secrets
- Ultra-specific implementation details that change often

---

## Writing Great Memories

Good memories are **findable**, **actionable**, and **standalone**.

### Title: make it searchable
```
❌  "Fixed the issue"
✅  "JWT refresh fails with 401 when token expires within 5 seconds"
```

### Content: include the why, not just the what
```
❌  "Use sync.Once for initialization"
✅  "OllamaEmbedder uses sync.Once for lazy dimension init. The constructor
    no longer blocks — it returns immediately. Dimension is populated on
    the first Embed() call. This prevents MCP server startup timeouts
    because clients can connect before Ollama is ready."
```

### Tags: broad categories for filtering
Use 2–5 tags. Good tag vocabulary: `architecture`, `bug`, `performance`,
`security`, `config`, `go`, `testing`, `database`, `api`, `refactoring`

### Source: set to `llm` when you create a memory yourself
```bash
cortex create ... --source llm
# or MCP: source: "llm"
```

---

## Search Strategies

Cortex uses **semantic similarity** — describe concepts, not exact strings.

| Good query style | Example |
|-----------------|---------|
| Describe the problem | `"timeout connecting to external service at startup"` |
| Describe the solution | `"lazy initialization pattern for embeddings"` |
| Describe the symptom | `"MCP client gets timeout before server responds"` |
| Domain + concept | `"Go concurrency sync.Once"` |

**Tips:**
- Use natural language, not code snippets
- If nothing relevant comes back at `min_score: 0.5`, try rephrasing — don't lower the score too much (< 0.4 = noise)
- Filter by level when you know where to look: `--level semantic` for conventions, `--level episodic` for past bugs
- Default `top_k: 5` is usually enough; use `10` when exploring unfamiliar territory

---

## Session Lifecycle

### At session start
```bash
# Get your session ID (deterministic from git branch)
SESSION_ID=$(cortex session id)
# Load working memories from the current session
cortex list --level working --session "$SESSION_ID"
# Use cortex get <id> to load full content of any relevant memory
# Then search broader context if needed:
cortex search "topic of your task" --level episodic
cortex search "topic of your task" --level semantic
```

### During a session (working memory)
```bash
# Store active state — always use your session ID
SESSION_ID=$(cortex session id)
cortex consolidate --level working --session "$SESSION_ID" \
  --content "Currently implementing auth, JWT approach chosen, see file auth.go"
```

### At session end
```bash
SESSION_ID=$(cortex session id)
# 1. Review working memories → promote worthy ones to episodic (NEVER directly to semantic)
cortex_review_session(session_id="$SESSION_ID")

# 2. Reflect on what was accomplished → promote to episodic
cortex_think_about_task_completion(task_description="...", outcome="...")

# 3. Semantic consolidation happens SEPARATELY via periodic maintenance:
#    cortex_think_about_memory_maintenance()
#    → Only after enough episodic evidence has accumulated
```

---

## Memory Lifecycle: Keep It Clean

Over time, promote and prune:

```
Working  ──promote──▶  Episodic  ──promote──▶  Semantic
         (valuable?)              (pattern?)
                    ──obsolete──▶  [hidden, prunable]
```

- **Promote** (`cortex_promote_memory`): when episodic knowledge becomes a general truth worth keeping forever
- **Mark obsolete** (`cortex_mark_obsolete`): when info is outdated but you want to preserve history (preferred over delete)
- **Update** (`cortex_update_memory`): fix errors, add context, improve a memory in place
- **Maintenance** (`cortex_think_about_memory_maintenance`): call periodically to get a health-check prompt

---

## Interface Reference

Read one of these based on your situation:

| If you have... | Read |
|----------------|------|
| `cortex_*` MCP tools in your tool list | [`references/mcp.md`](references/mcp.md) |
| `cortex` binary in the terminal | [`references/cli.md`](references/cli.md) |
| Both | MCP is preferred (richer response format, smarter deduplication) |
