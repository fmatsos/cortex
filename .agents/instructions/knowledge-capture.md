---
applyTo: "AGENTS.md,CLAUDE.md,.agents/**,docs/**"
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".agents/**"
  - "docs/**"
---

# Knowledge Capture Guide

**Path:** `.agents/instructions/knowledge-capture.md`
**Golden Rule:** 12 — *Update AGENTS.md after every completed task.*

---

## Purpose

Every completed task produces knowledge — a new constraint, a gotcha, a pattern, a workaround. If that knowledge stays only in the conversation or in your head, the next session starts from zero. This guide ensures learnings are captured in the right place, every time.

---

## Decision Tree

After completing a task, ask yourself one question:

> *"Must every future task check this, regardless of context?"*

```
                ┌─────────────────────────────────────────┐
                │  Did I learn something new during this   │
                │  task that isn't already in CLAUDE.md?    │
                └──────────────┬───────────────────────────┘
                               │
                          Yes ──┤── No → Done. No update needed.
                               │
                ┌──────────────▼───────────────────────────┐
                │  Must EVERY future task check this,       │
                │  regardless of context?                   │
                └──────────────┬───────────────────────────┘
                               │
                 ┌─── Yes ─────┤───── No ───┐
                 │             │             │
                 ▼             │             ▼
          Add Golden Rule      │      Create or update
          in AGENTS.md         │      a file in
                               │      .agents/instructions/
                               │
```

---

## Path A: Add a Golden Rule

### When to choose this path

- The learning is **universal** — it applies to all tasks, not just one area.
- Violating it **causes bugs, build failures, or broken integrations**.
- It can be expressed in **one or two sentences**.
- It is **always enforceable** — not situational or conditional.

### Examples of valid Golden Rules

| Scenario | Rule added |
|----------|------------|
| Discovered that `fmt.Println` in CLI commands breaks test capture | Rule 8: CLI output via `cmd.OutOrStdout()` |
| Found that renaming an MCP tool broke three integrations | Rule 9: Keep MCP tool names stable |
| Mock missing a method caused CI failure after interface change | Rule 11: Test mocks must satisfy the full interface |

### How to add

1. Identify the correct group: **Build & CI**, **Code Quality**, **Scope Discipline**, or create a new group if none fits.
2. Add the rule with the next available number.
3. Update the **Pre-Commit Self-Check** (rule 13) if the new rule needs a checklist item.

### Template

```markdown
N. **Short imperative title** — one-sentence explanation of what to do or never do.
```

---

## Path B: Create or Update an Instruction File

### When to choose this path

- The learning is **scoped** to a specific area (e.g., embeddings, MCP, storage).
- It requires **more than two sentences** to explain properly.
- It is **contextual** — only relevant when working on that specific area.
- It includes **steps, examples, configuration, or troubleshooting details**.

### Examples of valid instruction file updates

| Scenario | File created/updated |
|----------|---------------------|
| Discovered a specific Ollama timeout when embedding large batches | `.agents/instructions/embeddings.md` — added timeout section |
| Found a migration gotcha when changing Gob serialisation format | `.agents/instructions/storage.md` — added migration notes |
| Wrote a new MCP tool and documented the integration pattern | `.agents/instructions/mcp.md` — added tool registration recipe |
| Debugged a startup failure caused by missing config key | `.agents/instructions/troubleshooting.md` — added new error entry |

### How to add a new instruction file

1. **Choose the right file name** — use an existing file in `.agents/instructions/` if the topic fits, or create a new one (e.g., `batch-embedding-timeouts.md`).

2. **Create the file** with appropriate frontmatter for both Copilot (`applyTo`) and Claude (`paths`):

   ```markdown
   ---
   applyTo: "internal/embeddings/**"
   paths:
     - "internal/embeddings/**"
   ---

   # Title

   ## Purpose
   One paragraph explaining what this covers and when it applies.

   ## Content
   (Steps, examples, configuration, etc.)
   ```

3. **Create symlinks** for automatic loading:
   ```bash
   # Copilot (named <name>.instructions.md)
   ln -s "../../.agents/instructions/<name>.md" ".github/instructions/<name>.instructions.md"
   # Claude
   ln -s "../../.agents/instructions/<name>.md" ".claude/rules/<name>.md"
   # Backward compat
   ln -s "../../.agents/instructions/<name>.md" "docs/<category>/<name>.md"
   ```

---

## How to update an existing instruction file

If the learning fits an existing file in `.agents/instructions/`:

1. Open the file and add the new content in the appropriate section.
2. If the file doesn't have a section for your content, add one.
3. The symlinks in `docs/`, `.github/instructions/`, and `.claude/rules/` update automatically.

---

## Anti-Patterns

| Don't do this | Do this instead |
|---------------|-----------------|
| Skip the update because "it's obvious" | Write it down — obvious to you now, invisible to the next session |
| Add a Golden Rule for something scoped to one subsystem | Update an instruction file — Golden Rules are for universal constraints |
| Create a new file for a one-line fact | Add it to an existing instruction file or make it a Golden Rule |
| Write a vague file name like `notes.md` | Be specific: `batch-embedding-timeouts.md` |
| Forget to create the symlinks | Always create all three symlinks (docs/, .github/instructions/, .claude/rules/) |

---

## Quick Reference

```
Task complete
  │
  ├─ New learning? ── No → Done
  │
  ├─ Universal + critical? ── Yes → Golden Rule in AGENTS.md + update rule 13 checklist
  │
  └─ Scoped + contextual? ── Yes → New/updated file in .agents/instructions/ + symlinks
```

**Remember:** Rule 12 is non-negotiable. Undocumented knowledge is lost knowledge.
