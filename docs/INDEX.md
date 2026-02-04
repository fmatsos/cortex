# Cortex - Documentation Index

Complete guide to all Cortex documentation.

## Getting Started

**New to Cortex?** Start here:

1. [README.md](../README.md) - Quick start and feature overview
2. [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Commands and usage
3. [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Understanding memories

## Core Documentation

### User Guides

| Document | Purpose | For Whom |
|----------|---------|----------|
| [CLI_REFERENCE.md](./CLI_REFERENCE.md) | Complete command-line reference | Users, developers |
| [MEMORY_MODEL.md](./MEMORY_MODEL.md) | Memory structure and best practices | Users, power users |
| [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md) | Markdown import/export specification | Users doing bulk operations |
| [CONFIGURATION.md](./CONFIGURATION.md) | Configuration options and setup | Users, operators |
| [MCP.md](./MCP.md) | MCP integration with AI editors | Users with Claude Code/Cursor |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common issues and solutions | Users having problems |

### Architecture & Design

| Document | Purpose | For Whom |
|----------|---------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design and component details | Developers, contributors |
| [STORAGE.md](./STORAGE.md) | Storage layer and implementations | Developers, operators |
| [EMBEDDINGS.md](./EMBEDDINGS.md) | Vector generation and Ollama integration | Developers, DevOps |

### Development

| Document | Purpose | For Whom |
|----------|---------|----------|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Development setup and workflow | Contributors, developers |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contributing guidelines | Contributors |

---

## Quick Reference

### Commands

```bash
# Create a memory
cortex create --title "..." --type solution --content "..."

# Search semantically
cortex search "your query"

# List memories
cortex list [--type solution]

# Export to Markdown
cortex export --all --output ./memories/

# Import from Markdown
cortex import memory.md

# Start MCP server
cortex start-mcp-server
```

**Full reference:** [CLI_REFERENCE.md](./CLI_REFERENCE.md)

### Memory Types

- `solution` - Fix or workaround
- `issue` - Bug or problem
- `analysis` - Investigation findings
- `rule` - Convention or guideline
- `any` - Generic/uncategorized

**Details:** [MEMORY_MODEL.md](./MEMORY_MODEL.md)

### Configuration

```yaml
storage:
  backend: gob
  path: ~/.local/share/cortex-ai

embeddings:
  provider: ollama
  endpoint: http://localhost:11434
  model: nomic-embed-text

search:
  top_k: 5
  min_score: 0.5
```

**Full reference:** [CONFIGURATION.md](./CONFIGURATION.md)

---

## By Use Case

### "I want to..."

#### Use Cortex as a User

1. Start: [README.md](../README.md) quick start
2. Learn commands: [CLI_REFERENCE.md](./CLI_REFERENCE.md)
3. Understand memories: [MEMORY_MODEL.md](./MEMORY_MODEL.md)
4. Import/export: [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md)
5. Use with Claude Code: [MCP.md](./MCP.md)
6. Troubleshoot: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

#### Integrate with Claude Code or Cursor

1. Check: [MCP.md](./MCP.md) - MCP Integration
2. Configure: [CONFIGURATION.md](./CONFIGURATION.md) - Configuration
3. Troubleshoot: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - MCP issues

#### Bulk Import/Export Memories

1. Learn format: [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md)
2. Use commands: [CLI_REFERENCE.md](./CLI_REFERENCE.md) - import/export
3. Solve issues: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

#### Understand How Cortex Works

1. Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
2. Storage: [STORAGE.md](./STORAGE.md)
3. Embeddings: [EMBEDDINGS.md](./EMBEDDINGS.md)

#### Contribute or Extend Cortex

1. Setup: [DEVELOPMENT.md](./DEVELOPMENT.md)
2. Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
3. Guidelines: [CONTRIBUTING.md](./CONTRIBUTING.md)
4. Test: [DEVELOPMENT.md](./DEVELOPMENT.md) - Testing

#### Deploy Cortex

1. Installation: [README.md](../README.md) - Quick Start
2. Configuration: [CONFIGURATION.md](./CONFIGURATION.md)
3. Storage: [STORAGE.md](./STORAGE.md)
4. Troubleshooting: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

#### Troubleshoot Issues

1. Installation: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Installation Issues
2. Runtime: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Runtime Issues
3. Embeddings: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) & [EMBEDDINGS.md](./EMBEDDINGS.md)
4. Configuration: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Configuration Issues
5. Performance: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Performance Issues

---

## By Topic

### Installation & Setup

- [README.md](../README.md) - Installation instructions
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development setup
- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration

### Commands & Usage

- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - All commands
- [README.md](../README.md) - Basic usage
- [MCP.md](./MCP.md) - MCP tools/usage

### Memory Management

- [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Memory structure
- [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md) - Import/export format
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - CRUD commands

### Search & Discovery

- [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Memory types for search
- [EMBEDDINGS.md](./EMBEDDINGS.md) - How search works
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Search command

### Storage & Performance

- [STORAGE.md](./STORAGE.md) - Storage system
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture overview
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Performance issues

### Embeddings & AI

- [EMBEDDINGS.md](./EMBEDDINGS.md) - Vector system
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Embedding flow
- [CONFIGURATION.md](./CONFIGURATION.md) - Embedding config

### Integration with AI Editors

- [MCP.md](./MCP.md) - MCP integration guide
- [README.md](../README.md) - Quick start
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - MCP issues

### Development & Contributing

- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development setup
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contributing
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design

### Troubleshooting

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
- [EMBEDDINGS.md](./EMBEDDINGS.md) - Embedding issues
- [CONFIGURATION.md](./CONFIGURATION.md) - Config help

---

## Document Relationships

```
README.md (Quick Start)
  ├─→ CLI_REFERENCE.md (How to use)
  ├─→ MEMORY_MODEL.md (What to store)
  ├─→ CONFIGURATION.md (Setup)
  └─→ MCP.md (Integration)

ARCHITECTURE.md (System Design)
  ├─→ STORAGE.md (Storage layer)
  ├─→ EMBEDDINGS.md (Embeddings)
  └─→ DEVELOPMENT.md (Contribute)

MEMORY_MODEL.md (Memory Structure)
  └─→ MARKDOWN_FORMAT.md (Export format)

CONFIGURATION.md (Setup)
  ├─→ EMBEDDINGS.md (Embeddings config)
  └─→ STORAGE.md (Storage config)

TROUBLESHOOTING.md (Solutions)
  ├─→ EMBEDDINGS.md (Embedding issues)
  ├─→ CONFIGURATION.md (Config help)
  └─→ DEVELOPMENT.md (Dev debugging)

DEVELOPMENT.md (Development)
  ├─→ CONTRIBUTING.md (Guidelines)
  └─→ ARCHITECTURE.md (System design)
```

---

## Document Characteristics

### By Audience

**All Users:**
- [README.md](../README.md)
- [CLI_REFERENCE.md](./CLI_REFERENCE.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

**Power Users:**
- [MEMORY_MODEL.md](./MEMORY_MODEL.md)
- [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md)
- [CONFIGURATION.md](./CONFIGURATION.md)

**Developers:**
- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [STORAGE.md](./STORAGE.md)
- [EMBEDDINGS.md](./EMBEDDINGS.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)

**Operators/DevOps:**
- [CONFIGURATION.md](./CONFIGURATION.md)
- [STORAGE.md](./STORAGE.md)
- [EMBEDDINGS.md](./EMBEDDINGS.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

### By Depth

**Quick Reference (5-10 min):**
- [README.md](../README.md) - Overview
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Command list
- Quick Reference sections above

**Practical Guides (15-30 min):**
- [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Best practices
- [CONFIGURATION.md](./CONFIGURATION.md) - Setup
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Problem solving

**Deep Dives (30+ min):**
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [STORAGE.md](./STORAGE.md) - Storage details
- [EMBEDDINGS.md](./EMBEDDINGS.md) - Vectors in depth
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Full setup

---

## FAQ Pointers

**Q: How do I install Cortex?**
→ [README.md Quick Start](../README.md#quick-start)

**Q: What commands are available?**
→ [CLI_REFERENCE.md](./CLI_REFERENCE.md)

**Q: How do I use it with Claude Code?**
→ [MCP.md](./MCP.md)

**Q: How do I export/import memories?**
→ [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md)

**Q: What is a good memory structure?**
→ [MEMORY_MODEL.md - Best Practices](./MEMORY_MODEL.md#best-practices)

**Q: How does semantic search work?**
→ [EMBEDDINGS.md](./EMBEDDINGS.md)

**Q: How is data stored?**
→ [STORAGE.md](./STORAGE.md)

**Q: Something is not working, help!**
→ [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

**Q: How do I contribute?**
→ [CONTRIBUTING.md](./CONTRIBUTING.md)

**Q: Can I extend Cortex?**
→ [DEVELOPMENT.md](./DEVELOPMENT.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Recommended Reading Order

### For First-Time Users
1. [README.md](../README.md) - Get the big picture
2. [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Learn basic commands
3. [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Understand memory types
4. [MCP.md](./MCP.md) (if using Claude Code/Cursor)

### For Power Users
1. [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Deep dive into commands
2. [MEMORY_MODEL.md](./MEMORY_MODEL.md) - Master best practices
3. [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md) - Bulk operations
4. [CONFIGURATION.md](./CONFIGURATION.md) - Advanced setup

### For Developers
1. [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
2. [DEVELOPMENT.md](./DEVELOPMENT.md) - Setup environment
3. [STORAGE.md](./STORAGE.md) - Storage internals
4. [EMBEDDINGS.md](./EMBEDDINGS.md) - Vector system
5. [CONTRIBUTING.md](./CONTRIBUTING.md) - How to contribute

### For Operations/Deployment
1. [README.md](../README.md) - Overview
2. [CONFIGURATION.md](./CONFIGURATION.md) - Setup
3. [STORAGE.md](./STORAGE.md) - Storage management
4. [EMBEDDINGS.md](./EMBEDDINGS.md) - Ollama setup
5. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Operations

---

## Document Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| [README.md](../README.md) | ✅ Current | 2024-01 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | ✅ Current | 2024-01 |
| [CONFIGURATION.md](./CONFIGURATION.md) | ✅ Updated | 2025-02 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | ✅ Current | 2024-01 |
| [MCP.md](./MCP.md) | ✅ Current | 2024-01 |
| [CLI_REFERENCE.md](./CLI_REFERENCE.md) | ✅ New | 2024-01 |
| [MEMORY_MODEL.md](./MEMORY_MODEL.md) | ✅ New | 2024-01 |
| [MARKDOWN_FORMAT.md](./MARKDOWN_FORMAT.md) | ✅ New | 2024-01 |
| [STORAGE.md](./STORAGE.md) | ✅ New | 2024-01 |
| [EMBEDDINGS.md](./EMBEDDINGS.md) | ✅ Updated | 2025-02 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | ✅ New | 2024-01 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | ✅ New | 2024-01 |
| [INDEX.md](./INDEX.md) | ✅ Updated | 2025-02 |

---

## How to Use This Index

1. **Know what to learn?** → Go directly to that document
2. **Not sure where to start?** → Check "By Use Case" section
3. **Looking for specific topic?** → Check "By Topic" section
4. **Want a guided path?** → Follow "Recommended Reading Order"
5. **Stuck on a problem?** → Go to [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## Navigation

**You are here:** Documentation Index

- [Back to README](../README.md)
- [All Documentation](.)

For issues or corrections to documentation, file an issue at:
https://github.com/cortex-ai/cortex-ai/issues
