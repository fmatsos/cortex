# Cortex AI - Markdown Format Specification

Complete specification for the Markdown format used for memory import/export.

## Table of Contents

- [Overview](#overview)
- [YAML Frontmatter](#yaml-frontmatter)
- [Content Body](#content-body)
- [Examples](#examples)
- [Validation Rules](#validation-rules)
- [Troubleshooting](#troubleshooting)

---

## Overview

Cortex AI memories are exported to and imported from Markdown files with YAML frontmatter. This format enables:

- **Version control**: Track memories in git
- **Portability**: Export and share memories
- **Readability**: Human-friendly text format
- **Extensibility**: Support for custom metadata

### File Structure

```markdown
---
<YAML frontmatter>
---

<Markdown content>
```

---

## YAML Frontmatter

The frontmatter is a YAML block enclosed by `---` delimiters. It contains metadata about the memory.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Memory title (3-255 characters) |
| `type` | array or string | Memory type(s): solution, issue, analysis, rule, any |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | Generated | UUID v4 (auto-generated if omitted) |
| `tags` | array | [] | Classification tags |
| `metadata` | object | {} | Custom key-value data |
| `created_at` | timestamp | Now | Creation timestamp (RFC3339) |
| `updated_at` | timestamp | Now | Last update timestamp (RFC3339) |
| `obsolete` | boolean | false | Soft delete flag |

### Type Field

Can be specified as:

**Single type (string):**
```yaml
type: solution
```

**Multiple types (array):**
```yaml
type:
  - issue
  - solution
  - analysis
```

---

## Content Body

Everything after the closing `---` is treated as Markdown content.

### Content Guidelines

- **Format:** Standard GitHub-flavored Markdown
- **Minimum length:** 10 characters
- **Maximum length:** 1 MB
- **Sections:** Use headers (`#`, `##`, `###`) to structure content
- **Code blocks:** Use triple backticks with language specification

### Content Recommendations

Structure your memory content for clarity:

```markdown
## Problem
Describe the issue or context.

## Root Cause
Explain why it happens (if applicable).

## Solution
The fix, workaround, or implementation.

## Implementation
Code examples and steps.

## Related Resources
Links and references.
```

---

## Examples

### Example 1: Simple Solution

```markdown
---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
title: JWT Token Refresh Implementation
type: solution
tags:
  - jwt
  - authentication
  - security
created_at: 2024-01-10T14:22:00Z
updated_at: 2024-01-10T14:22:00Z
obsolete: false
---

When JWT tokens expire, implement refresh using a refresh token pattern with exponential backoff.

## Implementation

Use a refresh token endpoint that validates the refresh token and returns a new access token.

```go
func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (string, error) {
    // Validate refresh token
    claims, err := s.parseToken(refreshToken)
    if err != nil {
        return "", fmt.Errorf("invalid refresh token: %w", err)
    }

    // Generate new access token
    newToken := s.generateToken(claims.UserID)
    return newToken, nil
}
```

## Best Practices

- Always validate refresh tokens server-side
- Use secure HTTP-only cookies for refresh tokens
- Implement token rotation for added security
```

### Example 2: Issue + Solution + Analysis

```markdown
---
title: Race Condition in Auth Middleware
type:
  - issue
  - analysis
  - solution
tags:
  - concurrency
  - authentication
  - bug
metadata:
  severity: high
  related-pr: "#456"
  status: resolved
created_at: 2024-01-15T10:30:00Z
updated_at: 2024-01-20T16:45:00Z
obsolete: false
---

## Problem

The authentication middleware has a race condition when multiple requests with the same token arrive simultaneously. The token validation happens without proper locking, causing potential data corruption.

## Root Cause

The token cache update is not synchronized. Two goroutines can read a stale cache entry simultaneously, both attempt to validate, and both update the cache without coordination.

```go
// BUGGY CODE
func (m *Middleware) validateToken(token string) error {
    if cached, ok := m.cache[token]; ok {  // ← Race condition
        return cached.Error
    }

    valid := m.validate(token)
    m.cache[token] = valid  // ← Two goroutines can conflict
    return valid.Error
}
```

## Solution

Protect cache access with a mutex:

```go
// FIXED CODE
func (m *Middleware) validateToken(token string) error {
    m.cacheMu.RLock()
    if cached, ok := m.cache[token]; ok {
        m.cacheMu.RUnlock()
        return cached.Error
    }
    m.cacheMu.RUnlock()

    valid := m.validate(token)

    m.cacheMu.Lock()
    m.cache[token] = valid
    m.cacheMu.Unlock()

    return valid.Error
}
```

Or use sync.Once for one-time initialization per token:

```go
// BETTER: Use sync.Once pattern
type cachedToken struct {
    once  sync.Once
    err   error
}

func (m *Middleware) validateToken(token string) error {
    ct := m.getOrCreateCache(token)
    ct.once.Do(func() {
        ct.err = m.validate(token).Error
    })
    return ct.err
}
```

## Related

- PR: #456
- Issue: #445
```

### Example 3: Convention/Rule

```markdown
---
title: Always Use Context for Timeouts
type:
  - rule
  - analysis
tags:
  - golang
  - best-practices
  - concurrency
---

## Guideline

Always pass context with appropriate timeouts to I/O operations like HTTP requests, database queries, and RPC calls.

## Why

1. **Prevents hanging**: Operations will not block indefinitely
2. **Resource cleanup**: Context cancellation triggers proper cleanup
3. **Cascading cancellation**: Parent context cancellation propagates to children
4. **Timeout enforcement**: Ensures SLA compliance

## Examples

### HTTP Request
```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
```

### Database Query
```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

rows, err := db.QueryContext(ctx, "SELECT * FROM users")
```

### Goroutine Coordination
```go
ctx, cancel := context.WithCancel(context.Background())

go func() {
    <-ctx.Done()  // Exits when context is cancelled
    cleanup()
}()

cancel()  // Trigger cancellation
```
```

### Example 4: Minimal Example

```markdown
---
title: Quick Fix for X
type: solution
---

Simple explanation here without fancy structure.
```

---

## Validation Rules

### Parsing Rules

1. **Frontmatter**
   - Must start with `---` on first line
   - Must be valid YAML
   - Must end with `---` on its own line
   - Required: `title` field
   - Required: `type` field (string or array)

2. **Content**
   - Everything after closing `---`
   - Treated as Markdown
   - Minimum 10 characters
   - Maximum 1 MB

### Type Validation

```yaml
# Valid single type
type: solution

# Valid multiple types
type:
  - issue
  - solution

# Invalid: not a recognized type
type: bug  # ✗ Use "issue" instead

# Invalid: empty
type: []  # ✗ Must have at least one type
```

### Timestamp Format

All timestamps must be RFC3339 format:

```
✓ 2024-01-10T14:22:00Z
✓ 2024-01-10T14:22:00+00:00
✗ 2024-01-10 14:22:00
✗ 01/10/2024
```

---

## Import Workflow

When importing a Markdown file:

1. **Parse YAML frontmatter**
   - Extract all metadata fields
   - Validate required fields (title, type)
   - Validate field types and values

2. **Extract content**
   - Take everything after closing `---`
   - Preserve Markdown formatting
   - Trim leading/trailing whitespace

3. **Validate content**
   - Check minimum length (10 chars)
   - Check maximum length (1 MB)
   - Verify it's not empty/whitespace-only

4. **Generate embedding**
   - Combine title + content + tags
   - Send to Ollama
   - Normalize to unit vector

5. **Save to storage**
   - Use provided ID or generate new UUID
   - Set timestamps
   - Store with embedding

### Import Flags

```bash
# Standard import
cortex import memory.md

# Overwrite existing (if ID matches)
cortex import --force memory.md

# Validate without importing
cortex import --dry-run memory.md
```

---

## Export Workflow

When exporting a memory to Markdown:

1. **Generate YAML frontmatter**
   - Include all memory fields (except Embedding)
   - Use RFC3339 format for timestamps
   - Preserve array structure for Types and Tags

2. **Write content**
   - Use memory's Content field
   - Preserve original Markdown formatting

3. **Output to file**
   - Filename: `{title}.md` (sanitized)
   - Or custom output path
   - Create directory if needed

### Export Flags

```bash
# Export single memory
cortex export {id} --output memory.md

# Export all
cortex export --all --output ./memories/

# Export by type
cortex export --all --type solution --output ./solutions/

# Export synthesis
cortex export --intent "patterns" --output synthesis.md
```

---

## Troubleshooting

### "Invalid frontmatter: expected ---"

**Problem:** File doesn't start with `---` delimiter.

**Solution:** Ensure first line is exactly `---`:
```
---
title: ...
---
```

### "Missing required field: title"

**Problem:** The `title` field is missing from frontmatter.

**Solution:** Add `title` field:
```yaml
---
title: Memory Title
type: solution
---
```

### "Invalid type: unknown"

**Problem:** Used unsupported type value.

**Solution:** Use only: `solution`, `issue`, `analysis`, `rule`, `any`

### "Content too short"

**Problem:** Content is less than 10 characters.

**Solution:** Add more detailed content to the body.

### "Timestamp not in RFC3339 format"

**Problem:** Timestamp format is incorrect.

**Solution:** Use RFC3339 format:
```yaml
created_at: 2024-01-10T14:22:00Z
```

---

## Customizing Export Templates

Markdown export templates can be customized via the configuration file. This allows you to control the structure and content of exported files.

### Getting the JSON Schema

Export the template schema for reference:

```bash
cortex config schema markdown -o markdown-template.schema.json
```

### Creating a Custom Template

Create a YAML or JSON file with your template configuration:

```yaml
# my-template.yaml
memory:
  frontmatter:
    include_id: false
    include_dates: true
    include_metadata: false
    date_format: "2006-01-02"
  body: "## Content\n\n{{.Content}}"

synthesis:
  header: "# {{.Intent | title}}\n\nFound {{len .Results}} relevant memories."
  summary_section:
    title: "## Overview"
    content: "Key findings from the knowledge base:"
  learnings_section:
    title: "## Details"
    item_template: "### {{.Title}}\n\nRelevance: {{printf \"%.0f\" .Score}}%\n\n{{.Preview}}"
    content_preview_length: 300
  footer: "---\n\n*Exported from Cortex AI*"
```

### Validating Templates

Before using a custom template, validate it:

```bash
cortex config template validate my-template.yaml
```

The validator checks:
- JSON/YAML syntax
- Schema compliance
- Go template syntax
- Value constraints

### Using Custom Templates

Add the template configuration to your config file:

```yaml
# .ai/cortex/config.yaml
storage:
  path: .ai/cortex

templates:
  markdown:
    synthesis:
      header: "# {{.Intent | title}} Report"
      learnings_section:
        content_preview_length: 200
```

### Template Variables Reference

**Memory Export:**
| Variable | Description |
|----------|-------------|
| `{{.Content}}` | Full memory content |
| `{{.Title}}` | Memory title |
| `{{.Types}}` | Array of types |
| `{{.Tags}}` | Array of tags |
| `{{.CreatedAt}}` | Creation timestamp |
| `{{.UpdatedAt}}` | Update timestamp |

**Synthesis Export:**
| Variable | Context | Description |
|----------|---------|-------------|
| `{{.Intent}}` | Header | Search query |
| `{{len .Results}}` | Header | Result count |
| `{{.Title}}` | Item | Memory title |
| `{{.Score}}` | Item | Similarity (0-1) |
| `{{.Preview}}` | Item | Content preview |

**Template Functions:**
| Function | Description | Example |
|----------|-------------|---------|
| `title` | Title Case | `{{.Intent \| title}}` |
| `printf` | Format string | `{{printf "%.2f" .Score}}` |
| `len` | Array length | `{{len .Results}}` |

---

## Related Documentation

- [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Memory structure and fields
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Import/export commands
- [CONFIGURATION.md](./CONFIGURATION.md) - Full configuration reference
