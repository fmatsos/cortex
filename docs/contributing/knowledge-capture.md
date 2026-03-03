# Knowledge Capture Guide

**Path:** `docs/contributing/knowledge-capture.md`
**Golden Rule:** 12 — *Update CLAUDE.md after every completed task.*

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
          in CLAUDE.md         │      a doc in docs/
                               │      + add index row
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
3. If the rule relates to a specific doc, add a cross-link arrow (`→ Details: [doc](path)`).
4. Update the **Pre-Commit Self-Check** (rule 13) if the new rule needs a checklist item.
5. Update the **Documentation Index** "Rules to enforce" column for any rows where the new rule applies.

### Template

```markdown
N. **Short imperative title** — one-sentence explanation of what to do or never do.
   → Details: [`docs/path/to/doc.md`](docs/path/to/doc.md)
```

---

## Path B: Create or Update Documentation

### When to choose this path

- The learning is **scoped** to a specific area (e.g., embeddings, MCP, storage).
- It requires **more than two sentences** to explain properly.
- It is **contextual** — only relevant when working on that specific area.
- It includes **steps, examples, configuration, or troubleshooting details**.

### Examples of valid documentation updates

| Scenario | Doc created/updated |
|----------|---------------------|
| Discovered a specific Ollama timeout when embedding large batches | `docs/architecture/embeddings.md` — added timeout section |
| Found a migration gotcha when changing Gob serialisation format | `docs/architecture/storage.md` — added migration notes |
| Wrote a new MCP tool and documented the integration pattern | `docs/cli/mcp.md` — added tool registration recipe |
| Debugged a startup failure caused by missing config key | `docs/guides/troubleshooting.md` — added new error entry |

### How to add a new doc

1. **Choose the right directory:**

   | Directory | Content type |
      |-----------|-------------|
   | `docs/agent/` | Workflow, conventions, task recipes (agent-facing) |
   | `docs/cli/` | CLI commands, MCP tools, flags |
   | `docs/architecture/` | System design, data flow, storage, embeddings |
   | `docs/guides/` | Configuration, troubleshooting, how-tos |
   | `docs/contributing/` | Dev setup, PR process, contribution guidelines |

2. **Create the file** with a clear, descriptive name (e.g., `batch-embedding-timeouts.md`).

3. **Use this structure:**

   ```markdown
   # Title

   **Path:** `docs/<directory>/<filename>.md`

   ## Purpose
   One paragraph explaining what this doc covers and when to read it.

   ## Content
   (The actual documentation — steps, examples, configuration, etc.)

   ## Related
   - Golden Rules: list any applicable rule numbers
   - Related docs: link to other relevant docs
   ```

4. **Update `docs/INDEX.md`** — add the new doc to the full index.

### How to update the Documentation Index in CLAUDE.md

After creating or updating a doc, add or update a row in the Documentation Index table:

```markdown
| Your task involves                    | Doc                                        | What you'll find                  | Rules to enforce |
|---------------------------------------|--------------------------------------------|-----------------------------------|------------------|
| <trigger description>                 | [`docs/path/file.md`](docs/path/file.md)   | <brief content summary>          | <rule numbers>   |
```

**Checklist:**
- [ ] "Your task involves" clearly describes when to read this doc
- [ ] Doc path is correct and the file exists
- [ ] "What you'll find" is a concise summary (one line)
- [ ] "Rules to enforce" lists all Golden Rules that apply when working in this area
- [ ] `docs/INDEX.md` is also updated

---

## How to update an existing doc

If the learning fits an existing doc:

1. Open the doc and add the new content in the appropriate section.
2. If the doc doesn't have a section for your content, add one.
3. Check if the Documentation Index row for that doc still accurately describes its content — update "What you'll find" if needed.
4. No need to add a new index row if the existing one already covers the trigger.

---

## Anti-Patterns

| Don't do this | Do this instead |
|---------------|-----------------|
| Skip the update because "it's obvious" | Write it down — obvious to you now, invisible to the next session |
| Add a Golden Rule for something scoped to one subsystem | Create a doc — Golden Rules are for universal constraints |
| Create a new doc for a one-line fact | Add it to an existing doc or make it a Golden Rule |
| Write a vague trigger like "general development" | Be specific: "Configuring Ollama batch timeouts" |
| Forget to update the index | Always update both the doc AND the Documentation Index + `docs/INDEX.md` |
| Add a doc but skip the "Rules to enforce" mapping | Always map applicable Golden Rules — this is what links the two systems |

---

## Quick Reference

```
Task complete
  │
  ├─ New learning? ── No → Done
  │
  ├─ Universal + critical? ── Yes → Golden Rule + update rule 13 checklist + update index "Rules to enforce"
  │
  └─ Scoped + contextual? ── Yes → New/updated doc + new/updated index row + update docs/INDEX.md
```

**Remember:** Rule 12 is non-negotiable. Undocumented knowledge is lost knowledge.
