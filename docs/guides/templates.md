# Cortex - Custom Templates Guide

Complete guide for customizing Cortex markdown exports using templates.

## Table of Contents

- [Overview](#overview)
- [Template Types](#template-types)
- [Template Formats](#template-formats)
- [Using Templates](#using-templates)
- [Template Variables](#template-variables)
- [Template Functions](#template-functions)
- [JSON Schemas](#json-schemas)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

Cortex allows you to customize the markdown output of memory and synthesis exports using Go templates. Templates can be configured in three ways:

1. **Config File** - Set defaults in your `config.yaml`
2. **Command Line** - Override with `--memory-template` or `--synthesis-template` flags
3. **Inline** - Specify template strings directly in config

Templates use [Go's text/template](https://pkg.go.dev/text/template) syntax for dynamic content generation.

---

## Template Types

### Memory Templates

Control how individual memories are exported to markdown:

- **Frontmatter** - YAML metadata at the top of the file
- **Body** - Main content using Go template syntax

### Synthesis Templates

Control how synthesis documents (from semantic search) are generated:

- **Header** - Document title and intro
- **Summary Section** - Overview text
- **Learnings Section** - Individual memory items
- **Footer** - Closing text

### Complete Templates

Combine both memory and synthesis templates in a single file for consistency.

---

## Template Formats

### YAML Format (`.yaml`, `.yml`)

Structured configuration with all options:

```yaml
frontmatter:
  include_id: true
  include_dates: true
  include_metadata: false
  date_format: "2006-01-02"

body: |
  # {{.Title}}
  
  {{.Content}}
```

### JSON Format (`.json`)

Alternative structured format:

```json
{
  "frontmatter": {
    "include_id": true,
    "date_format": "2006-01-02"
  },
  "body": "# {{.Title}}\n\n{{.Content}}"
}
```

### Template Format (`.tmpl`)

Plain Go template (memory body only):

```
## {{.Title}}

> Created: {{.CreatedAt.Format "Jan 2, 2006"}}

{{.Content}}
```

---

## Using Templates

### From Config File

Add to `.ai/cortex/config.yaml`:

```yaml
templates:
  markdown:
    memory:
      frontmatter:
        include_id: false
        include_dates: true
        date_format: "2006-01-02"
      body: |
        # {{.Title}}
        
        {{if .Tags}}**Tags:** {{range .Tags}}#{{.}}{{end}}{{end}}
        
        {{.Content}}
    
    synthesis:
      header: "# {{.Intent | title}} - Knowledge Synthesis"
      learnings_section:
        item_template: "### {{.Title}} ({{printf \"%.0f%%\" (mul .Score 100)}})\n\n{{.Preview}}"
        content_preview_length: 400
```

### From Command Line

Override config file templates:

```bash
# Use custom memory template
cortex export abc-123 \
  --format markdown \
  --memory-template ./templates/memory.yaml

# Use custom synthesis template  
cortex export \
  --intent "authentication" \
  --format markdown \
  --synthesis-template ./templates/synthesis.yaml

# Use both
cortex export --all \
  --format markdown \
  --memory-template ./templates/memory.yaml
```

### Validating Templates

Check template syntax before using:

```bash
# Auto-detect template type
cortex validate-template memory.yaml

# Specify type explicitly
cortex validate-template --type synthesis synthesis.yaml

# Validate all templates
for f in templates/*.yaml; do
  cortex validate-template "$f"
done
```

---

## Template Variables

### Memory Template Variables

Available in `body` field:

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `.Title` | string | Memory title | `"Authentication Bug Fix"` |
| `.Content` | string | Memory content | `"The bug was caused by..."` |
| `.Types` | []string | Memory types | `["solution", "issue"]` |
| `.Tags` | []string | Tags | `["auth", "security"]` |
| `.CreatedAt` | time.Time | Creation time | `2024-01-15T10:30:00Z` |
| `.UpdatedAt` | time.Time | Update time | `2024-01-16T14:20:00Z` |
| `.Metadata` | map[string]string | Custom metadata | `{"author": "john"}` |

### Synthesis Template Variables

Available in synthesis template fields:

#### Header/Footer Context

| Variable | Type | Description |
|----------|------|-------------|
| `.Intent` | string | Search query/intent |
| `.Results` | []SearchResult | Array of results |

#### Item Template Context

| Variable | Type | Description |
|----------|------|-------------|
| `.Title` | string | Memory title |
| `.Score` | float64 | Relevance score (0.0-1.0) |
| `.Preview` | string | Content preview |

---

## Template Functions

Go template functions available in all templates:

### title

Convert string to title case:

```go
{{.Intent | title}}
// "authentication bugs" → "Authentication Bugs"
```

### printf

Format strings and numbers:

```go
{{printf "%.2f" .Score}}
// 0.8532 → "0.85"

{{printf "%.0f%%" (mul .Score 100)}}
// 0.85 → "85%"
```

### mul

Multiply numbers:

```go
{{mul .Score 100}}
// 0.85 → 85.0
```

### len

Get array length:

```go
{{len .Results}} memories found
// "5 memories found"
```

### Standard Go Functions

All standard [text/template functions](https://pkg.go.dev/text/template#hdr-Functions) are available:

- `and`, `or`, `not` - Boolean logic
- `eq`, `ne`, `lt`, `le`, `gt`, `ge` - Comparisons
- `index` - Array/map access
- `range` - Iteration

---

## JSON Schemas

Cortex provides JSON Schemas for template validation:

### Memory Template Schema

Location: `internal/schemas/templates/memory_template.schema.json`

Validates:
- Frontmatter options
- Body template syntax
- Required fields

### Synthesis Template Schema

Location: `internal/schemas/templates/synthesis_template.schema.json`

Validates:
- All synthesis sections
- Template syntax
- Section structure

### Complete Markdown Schema

Location: `internal/schemas/templates/markdown_template.schema.json`

Validates complete templates with both memory and synthesis configs.

---

## Examples

### Example 1: Minimal Memory Template

```yaml
# minimal.yaml
body: "{{.Content}}"
```

### Example 2: Memory with Tags

```yaml
# with-tags.yaml
frontmatter:
  include_id: false
  include_dates: true

body: |
  # {{.Title}}
  
  {{if .Tags}}
  **Tags:** {{range $i, $tag := .Tags}}{{if $i}}, {{end}}#{{$tag}}{{end}}
  {{end}}
  
  {{.Content}}
```

### Example 3: Custom Date Format

```yaml
# custom-dates.yaml
frontmatter:
  date_format: "Jan 2, 2006 at 3:04 PM"

body: |
  # {{.Title}}
  
  > Created {{.CreatedAt.Format "January 2, 2006"}}
  
  {{.Content}}
```

### Example 4: Synthesis with Emojis

```yaml
# synthesis-emoji.yaml
header: |
  # 📚 {{.Intent | title}}
  
  Found {{len .Results}} relevant memories

learnings_section:
  title: "## 💡 Insights"
  item_template: |
    ### ✓ {{.Title}}
    
    **Relevance:** {{printf "%.0f%%" (mul .Score 100)}}
    
    {{.Preview}}
```

### Example 5: Conditional Metadata

```yaml
# conditional.yaml
body: |
  # {{.Title}}
  
  {{.Content}}
  
  {{if .Metadata}}
  ---
  ## 📎 Additional Info
  {{range $key, $value := .Metadata}}
  - **{{$key}}:** {{$value}}
  {{end}}
  {{end}}
```

More examples available in `docs/examples/templates/`.

---

## Troubleshooting

### Common Issues

#### Template Validation Failed

**Error:** `invalid Go template: template: memory.body:1: unexpected "{"...`

**Solution:** Check for syntax errors in your template:
- Unclosed braces: `{{.Title` should be `{{.Title}}`
- Missing pipes: `{{.Title title}}` should be `{{.Title | title}}`
- Invalid functions: Check function names are correct

#### Function Not Defined

**Error:** `function "multiply" not defined`

**Solution:** Use the correct function name (`mul` not `multiply`). See [Template Functions](#template-functions).

#### Template Type Mismatch

**Error:** `.tmpl format not supported for synthesis templates`

**Solution:** Use `.yaml` or `.json` for synthesis templates. The `.tmpl` format is only for memory body templates.

#### Variables Not Available

**Error:** Template renders but variables are empty

**Solution:** Check you're using the correct variables for your template type:
- Memory templates: Use `.Title`, `.Content`, etc.
- Synthesis templates: Context depends on section (header vs item)

### Debugging Tips

1. **Start Simple** - Begin with `body: "{{.Content}}"` and add complexity
2. **Validate Often** - Run `cortex validate-template` after each change
3. **Check Examples** - Reference `docs/examples/templates/`
4. **Test Export** - Export a real memory to see the actual output
5. **Read Errors** - Validation errors show exactly where the problem is

### Getting Help

If you encounter issues:

1. Run validation: `cortex validate-template your-template.yaml`
2. Check example templates: `docs/examples/templates/`
3. Review this documentation
4. Check the JSON schemas in `internal/schemas/templates/`

---

## Best Practices

### Template Design

1. **Keep It Simple** - Start with minimal templates and add features gradually
2. **Use Comments** - YAML supports comments to document your templates
3. **Test Thoroughly** - Validate and test export with real data
4. **Version Control** - Keep templates in git for tracking changes
5. **Share Templates** - Use consistent templates across your team

### Performance

1. **Preview Length** - Set appropriate `content_preview_length` for synthesis
2. **Minimal Processing** - Avoid complex logic in templates
3. **Cache Templates** - Cortex caches loaded templates automatically

### Maintenance

1. **Validate Regularly** - Run validation as part of CI/CD
2. **Document Changes** - Note why template changes were made
3. **Backup Defaults** - Keep a copy of default templates
4. **Test After Updates** - Verify templates work after Cortex updates

---

## Related Documentation

- [Markdown Format Specification](markdown-format.md)
- [Configuration Reference](configuration.md)
- [CLI Reference](../cli/reference.md)
- [Example Templates](./examples/templates/)
