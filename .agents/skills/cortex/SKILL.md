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

# Cortex Memory

## Core Habits

| Moment | Action |
|--------|--------|
| **Task starts** | Search for prior context — ALWAYS before diving in |
| **Decision made** | Store decision + rationale as **episodic** |
| **Bug fixed** | Store symptoms + root cause + fix as **episodic** |
| **Pattern found** | Episodic first; promote to **semantic** after it recurs |
| **Session ends** | Call `cortex_review_session` or `cortex transfer-working` |

## Three Layers

| Layer | Purpose | Retention |
|-------|---------|-----------|
| **working** | Active session state, debug scratchpad | Session only |
| **episodic** | Bugs fixed, decisions made, events | 90 days |
| **semantic** | Conventions, patterns, "always true" knowledge | Forever |

**Rule:** temporary → `working` · specific event → `episodic` · general knowledge → `semantic`
Unsure? Call `cortex_choose_memory_layer` (MCP) or `cortex consolidate` (CLI) — both handle deduplication.

## Search First (90% case)

```bash
cortex search "topic" --level semantic    # conventions / patterns
cortex search "topic" --level episodic    # past bugs / decisions
```

MCP: `cortex_search({ query: "topic", level: "semantic" })`

## Store a Lesson (90% case)

```bash
cortex consolidate --level episodic --content "Symptoms: … Root cause: … Fix: …" --source llm
```

MCP: `cortex_consolidate({ synthesis: "…", memory_level: "episodic", context: { source: "llm" } })`

## References

| Need | Read |
|------|------|
| Full MCP tool signatures (16 tools) | [`references/mcp.md`](references/mcp.md) |
| Full CLI commands + flags | [`references/cli.md`](references/cli.md) |
| Session lifecycle, maintenance, promotion | [`references/workflows.md`](references/workflows.md) |
