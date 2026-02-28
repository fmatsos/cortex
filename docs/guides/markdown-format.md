# Cortex - Markdown Format Specification

Complete specification for the Markdown format used for memory import/export.

## Table of Contents

- [Overview](#overview)
- [YAML Frontmatter](#yaml-frontmatter)
- [Content Body](#content-body)
- [Examples](#examples)
- [Import / Export](#import--export)
- [Validation Rules](#validation-rules)
- [Customizing Export Templates](#customizing-export-templates)
- [Troubleshooting](#troubleshooting)

---

## Overview

Cortex memories can be exported to and imported from Markdown files with YAML frontmatter. The default export/import format is **JSON**; use `--format markdown` to work with Markdown files.

This format enables:

- **Version control**: Track memories in git
- **Portability**: Export and share memories
- **Readability**: Human-friendly text format

### File Structure

```markdown
---
<YAML frontmatter>
---

<Markdown content>
```

### Import / Export Flow

```mermaid
flowchart LR
    A[Markdown file<br/>(.md)] -->|cortex import --format markdown| B[Parse frontmatter]
    B --> C[Validate fields]
    C --> D[Generate embedding]
    D --> E[(Memory Store)]

    E -->|cortex export --format markdown| F[Serialize frontmatter]
    F --> G[Write content]
    G --> H[Markdown file<br/>(.md)]

    style A fill:#fff4e6,stroke:#fd7e14
    style E fill:#d3f9d8,stroke:#37b24d
    style H fill:#fff4e6,stroke:#fd7e14
```

> **Note**: `cortex export` defaults to JSON format. Pass `--format markdown` to produce Markdown files.

---

## YAML Frontmatter

The frontmatter is a YAML block enclosed by `---` delimiters. It contains metadata about the memory.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Memory title (3–255 characters) |
| `level` | string | Memory level: `working`, `episodic`, or `semantic` |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | Generated | UUID v4 (auto-generated if omitted) |
| `session_id` | string | — | Session identifier (required when `level: working`) |
| `tags` | array | `[]` | Classification tags |
| `created_at` | timestamp | Now | Creation timestamp (RFC3339) |
| `updated_at` | timestamp | Now | Last update timestamp (RFC3339) |
| `obsolete` | boolean | `false` | Soft-delete flag |

### Level Field

| Value | Description |
|-------|-------------|
| `working` | Temporary session context. Requires `session_id`. |
| `episodic` | Time-bound events, decisions, incidents. |
| `semantic` | Permanent knowledge, conventions, patterns. |

---

## Content Body

Everything after the closing `---` is treated as Markdown content.

### Guidelines

- **Format:** Standard GitHub-flavored Markdown
- **Minimum length:** 10 characters
- **Supports:** headers, code blocks, lists, tables

### Recommended Structure

```markdown
## Problem
Describe the issue or context.

## Root Cause
Explain why it happens (if applicable).

## Solution
The fix, workaround, or implementation.

## Related Resources
Links and references.
```

---

## Examples

### Example 1: Semantic Memory (Permanent Knowledge)

````markdown
---
title: JWT Token Refresh Pattern
level: semantic
tags:
  - jwt
  - authentication
  - security
---

When JWT tokens expire, use a refresh token pattern with exponential backoff.

## Implementation

```go
func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (string, error) {
    claims, err := s.parseToken(refreshToken)
    if err != nil {
        return "", fmt.Errorf("invalid refresh token: %w", err)
    }
    return s.generateToken(claims.UserID), nil
}
```
````

### Example 2: Episodic Memory (Time-Bound Event)

```markdown
---
title: Race Condition in Auth Middleware
level: episodic
tags:
  - concurrency
  - authentication
  - bugfix
created_at: 2024-01-15T10:30:00Z
---

## Problem

Token cache updates were not synchronized, causing corruption under concurrent load.

## Solution

Protected cache access with a read-write mutex.
```

### Example 3: Working Memory (Session Context)

```markdown
---
title: Investigating auth timeout
level: working
session_id: session-fix-sil-123
tags:
  - debugging
  - auth
---

Reproduced timeout after 30s of idle connection. Next step: add tracing to token cache lookup.
```

### Example 4: Minimal

```markdown
---
title: Use context for all I/O
level: semantic
---

Always pass `context.Context` with a timeout to HTTP, database, and RPC calls.
```

---

## Import / Export

### Importing Memories

```bash
# Import a Markdown file
cortex import --format markdown memory.md

# Import multiple files
cortex import --format markdown ./memories/*.md

# Validate without importing
cortex import --format markdown --dry-run memory.md

# Overwrite existing memory (if ID matches)
cortex import --format markdown --force memory.md
```

### Exporting Memories

```bash
# Export a single memory as Markdown
cortex export <id> --format markdown --output ./memories/

# Export all memories as Markdown
cortex export --all --format markdown --output ./memories/

# Export a synthesis (semantic search across memories)
cortex export --intent "authentication patterns" --format markdown --output ./

# Use a custom template
cortex export --all --format markdown --memory-template my-template.yaml --output ./
```

> **Default format is JSON.** Omit `--format markdown` for JSON export/import.

---

## Validation Rules

### Frontmatter Rules

1. Must start with `---` on first line
2. Must be valid YAML
3. Must end with `---` on its own line
4. `title` is required (3–255 characters)
5. `level` is required: `working`, `episodic`, or `semantic`
6. `session_id` is required when `level: working`

### Content Rules

- Minimum 10 characters (excluding whitespace)

### Timestamp Format

All timestamps must be RFC3339:

```
✓ 2024-01-10T14:22:00Z
✓ 2024-01-10T14:22:00+00:00
✗ 2024-01-10 14:22:00
✗ 01/10/2024
```

---

## Customizing Export Templates

Markdown export output can be customized via the configuration file.

### Getting the Schema

```bash
cortex config schema markdown
cortex config schema markdown -o markdown-template.schema.json
```

### Creating a Custom Template

```yaml
# my-template.yaml
memory:
  frontmatter:
    include_id: false
    include_dates: true
    date_format: "2006-01-02"
  body: "## Content\n\n{{.Content}}"

synthesis:
  header: "# {{.Intent | title}}\n\nFound {{len .Results}} relevant memories."
  learnings_section:
    item_template: "### {{.Title}}\n\n{{.Preview}}"
    content_preview_length: 300
  footer: "---\n\n*Exported from Cortex*"
```

### Validating Templates

```bash
cortex config template validate my-template.yaml
```

### Using Templates in Config

```yaml
# .ai/cortex/config.yaml
templates:
  markdown:
    synthesis:
      header: "# {{.Intent | title}} Report"
      learnings_section:
        content_preview_length: 200
```

### Template Variables

**Memory Export:**

| Variable | Description |
|----------|-------------|
| `{{.Content}}` | Full memory content |
| `{{.Title}}` | Memory title |
| `{{.Tags}}` | Array of tags |
| `{{.CreatedAt}}` | Creation timestamp |
| `{{.UpdatedAt}}` | Update timestamp |

**Synthesis Export:**

| Variable | Context | Description |
|----------|---------|-------------|
| `{{.Intent}}` | Header | Search query |
| `{{len .Results}}` | Header | Result count |
| `{{.Title}}` | Item | Memory title |
| `{{.Score}}` | Item | Similarity score (0–1) |
| `{{.Preview}}` | Item | Content preview |

**Template Functions:**

| Function | Example |
|----------|---------|
| `title` | `{{.Intent \| title}}` |
| `printf` | `{{printf "%.2f" .Score}}` |
| `len` | `{{len .Results}}` |

---

## Troubleshooting

### "Invalid frontmatter: expected ---"

File doesn't start with `---`. Ensure the very first line is exactly `---`.

### "Missing required field: title"

Add a `title` field to the frontmatter.

### "Missing required field: level"

Add `level: working`, `level: episodic`, or `level: semantic` to the frontmatter.

### "session_id required for working level"

Working memories require a session identifier:

```yaml
level: working
session_id: my-session-id
```

### "Content too short"

Add more content to the body (minimum 10 characters).

### "Timestamp not in RFC3339 format"

Use RFC3339 format: `created_at: 2024-01-10T14:22:00Z`

---

## Related Documentation

- [Memory Model](../architecture/memory-model.md) - Memory structure and levels
- [CLI Reference](../cli/reference.md) - Import/export commands
- [Configuration](configuration.md) - Full configuration reference
