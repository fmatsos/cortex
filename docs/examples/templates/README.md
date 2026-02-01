# Custom Template Examples

This directory contains example custom templates for Cortex AI exports.

## Template Types

Cortex AI supports custom templates for two export types:

1. **Memory Templates** - For exporting individual memories
2. **Synthesis Templates** - For exporting synthesis documents from search results

## Template Formats

Templates can be written in multiple formats:

- **YAML** (`.yaml`, `.yml`) - Structured configuration format
- **JSON** (`.json`) - Alternative structured format
- **Template** (`.tmpl`) - Plain Go template (memory body only)

## Available Templates

### Memory Templates

- `memory-simple.yaml` - Simple memory template with minimal frontmatter
- `memory-detailed.yaml` - Detailed memory template with all options
- `memory-custom.tmpl` - Custom body template using Go template syntax

### Synthesis Templates

- `synthesis-simple.yaml` - Simple synthesis template
- `synthesis-detailed.yaml` - Detailed synthesis template with custom sections

### Complete Templates

- `markdown-full.yaml` - Complete template with both memory and synthesis configs

## Using Templates

### From Config File

Add templates to your `config.yaml`:

```yaml
templates:
  markdown:
    memory:
      body: "# {{.Title}}\n\n{{.Content}}"
      frontmatter:
        include_id: false
    synthesis:
      header: "# Synthesis: {{.Intent}}"
```

### From Command Line

Use template files with the export command:

```bash
# Use custom memory template
cortex export <id> --format markdown --memory-template memory-custom.yaml

# Use custom synthesis template
cortex export --intent "auth" --format markdown --synthesis-template synthesis-custom.yaml
```

## Validating Templates

Validate your custom templates before using them:

```bash
cortex validate-template memory-custom.yaml
cortex validate-template synthesis-custom.yaml
```

## Template Variables

### Memory Templates

Available variables in memory body templates:

- `.Title` - Memory title
- `.Content` - Memory content
- `.Types` - Array of memory types
- `.Tags` - Array of tags
- `.CreatedAt` - Creation timestamp
- `.UpdatedAt` - Update timestamp
- `.Metadata` - Custom metadata map

### Synthesis Templates

Available variables in synthesis templates:

- `.Intent` - Search intent/query
- `.Results` - Array of search results
- `.Title` - Result memory title
- `.Score` - Relevance score (0.0-1.0)
- `.Preview` - Content preview

## Template Functions

Available Go template functions:

- `title` - Convert string to title case
- `printf` - Format string (e.g., `{{printf "%.2f" .Score}}`)
- `mul` - Multiply numbers (e.g., `{{mul .Score 100}}`)
- `len` - Get array length (e.g., `{{len .Results}}`)

See individual template files for more examples.
