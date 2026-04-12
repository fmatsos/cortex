# Cortex Workflows

Common end-to-end patterns. Commands shown in both CLI and MCP form.

---

## Task Start — Load Prior Context

```bash
# CLI
cortex search "topic of your task" --level semantic
cortex search "topic of your task" --level episodic
```

```
# MCP
cortex_search({ query: "topic", level: "semantic" })
cortex_search({ query: "topic", level: "episodic" })
```

Read results before starting work. If nothing useful found, proceed without context.

---

## Store a Bug Fix

```bash
# CLI
cortex consolidate --level episodic --source llm \
  --content "Symptoms: <what you saw>. Root cause: <why>. Fix: <how>. Files: <paths>." \
  --tags "bug,<area>"
```

```
# MCP
cortex_consolidate({ synthesis: "Symptoms: … Root cause: … Fix: … Files: …",
  memory_level: "episodic", context: { source: "llm", tags: ["bug","area"] } })
```

---

## Store a Decision

```bash
# CLI
cortex consolidate --level episodic --source llm \
  --content "Decision: <what>. Rationale: <why>. Alternatives considered: <what>."
```

```
# MCP
cortex_consolidate({ synthesis: "Decision: … Rationale: … Alternatives: …",
  memory_level: "episodic", context: { source: "llm", tags: ["decision","arch"] } })
```

---

## Session End — 3 Steps

```bash
# Step 1: Review working memories → promote worthy ones to episodic (NEVER directly to semantic)
SESSION=$(cortex session id)
cortex_review_session({ session_id: "$SESSION", task_summary: "Brief summary of work done" })
# → Read the returned prompt and act on each working memory

# Step 2: Reflect on what was accomplished
cortex_think_about_task_completion({ task_description: "…", outcome: "…", session_id: "$SESSION" })
# → Create recommended episodic memories

# Step 3: Transfer remaining working memories to episodic
cortex transfer-working   # CLI
# or: cortex_list({ level: "working", session_id: "…" }) then cortex_promote_memory each
```

---

## Promote Episodic → Semantic

Use when an episodic memory has been validated by multiple events and represents a durable truth.

```
# MCP (preferred — handles deduplication)
cortex_promote_memory({ memory_id: "abc123",
  revised_title: "Optional clearer title", revised_content: "Optional refined content",
  tags: ["patterns","arch"] })
```

```bash
# CLI equivalent: create semantic + mark episodic obsolete
cortex create --level semantic --title "…" --content "…" --tags "patterns" --source llm
cortex delete <episodic-id>
```

---

## Memory Maintenance (periodic, not every session)

```
# MCP
cortex_think_about_memory_maintenance({ focus_level: "episodic", focus_tags: ["bug"] })
# → Read prompt, identify: obsolete memories, patterns ready for semantic, items to merge
```

```bash
# CLI
cortex stats                   # check counts
cortex autoprune --dry-run     # preview cleanup
cortex autoprune               # execute: remove duplicates, archive old episodic, merge semantic
```

---

## Check What You Know About a Topic

```bash
cortex search "topic" --level semantic --top 10
cortex search "topic" --level episodic --top 10
```

If a memory is outdated, mark it obsolete and store a fresh one:
```
cortex_mark_obsolete({ memory_id: "old-id", reason: "Superseded by new approach" })
cortex_consolidate({ synthesis: "Updated knowledge…", memory_level: "semantic", … })
```
