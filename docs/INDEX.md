# Cortex - Documentation Index

Complete guide to all Cortex documentation.

## Getting Started

**New to Cortex?** Start here:

1. [README.md](../README.md) - Quick start and feature overview
2. [cli/reference.md](cli/reference.md) - Commands and usage
3. [architecture/memory-model.md](architecture/memory-model.md) - Understanding memories

## Core Documentation

### Agent Guides (AI / Claude Code)

| Document | Purpose |
|----------|---------|
| [agent/workflow.md](agent/workflow.md) | Build/test/lint workflow, pre-commit checklist, env vars |
| [agent/conventions.md](agent/conventions.md) | Go code style, naming, error handling |
| [agent/tasks.md](agent/tasks.md) | Common dev tasks: add command, add MCP tool, etc. |

### User Guides

| Document | Purpose | For Whom |
|----------|---------|----------|
| [cli/reference.md](cli/reference.md) | Complete command-line reference | Users, developers |
| [architecture/memory-model.md](architecture/memory-model.md) | Memory structure and best practices | Users, power users |
| [guides/markdown-format.md](guides/markdown-format.md) | Markdown import/export specification | Users doing bulk operations |
| [guides/configuration.md](guides/configuration.md) | Configuration options and setup | Users, operators |
| [cli/mcp.md](cli/mcp.md) | MCP integration with AI editors | Users with Claude Code/Cursor |
| [guides/troubleshooting.md](guides/troubleshooting.md) | Common issues and solutions | Users having problems |

### Architecture & Design

| Document | Purpose | For Whom |
|----------|---------|----------|
| [architecture/overview.md](architecture/overview.md) | System design and component details | Developers, contributors |
| [architecture/storage.md](architecture/storage.md) | Storage layer and implementations | Developers, operators |
| [architecture/embeddings.md](architecture/embeddings.md) | Vector generation and Ollama integration | Developers, DevOps |

### Development

| Document | Purpose | For Whom |
|----------|---------|----------|
| [contributing/development.md](contributing/development.md) | Development setup and workflow | Contributors, developers |
| [contributing/contributing.md](contributing/contributing.md) | Contributing guidelines | Contributors |

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

**Full reference:** [cli/reference.md](cli/reference.md)

### Memory Types

- `solution` - Fix or workaround
- `issue` - Bug or problem
- `analysis` - Investigation findings
- `rule` - Convention or guideline
- `any` - Generic/uncategorized

**Details:** [architecture/memory-model.md](architecture/memory-model.md)

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

**Full reference:** [guides/configuration.md](guides/configuration.md)

---

## By Use Case

### "I want to..."

#### Use Cortex as a User

1. Start: [README.md](../README.md) quick start
2. Learn commands: [cli/reference.md](cli/reference.md)
3. Understand memories: [architecture/memory-model.md](architecture/memory-model.md)
4. Import/export: [guides/markdown-format.md](guides/markdown-format.md)
5. Use with Claude Code: [cli/mcp.md](cli/mcp.md)
6. Troubleshoot: [guides/troubleshooting.md](guides/troubleshooting.md)

#### Integrate with Claude Code or Cursor

1. Check: [cli/mcp.md](cli/mcp.md) - MCP Integration
2. Configure: [guides/configuration.md](guides/configuration.md) - Configuration
3. Troubleshoot: [guides/troubleshooting.md](guides/troubleshooting.md) - MCP issues

#### Bulk Import/Export Memories

1. Learn format: [guides/markdown-format.md](guides/markdown-format.md)
2. Use commands: [cli/reference.md](cli/reference.md) - import/export
3. Solve issues: [guides/troubleshooting.md](guides/troubleshooting.md)

#### Understand How Cortex Works

1. Architecture: [architecture/overview.md](architecture/overview.md)
2. Storage: [architecture/storage.md](architecture/storage.md)
3. Embeddings: [architecture/embeddings.md](architecture/embeddings.md)

#### Contribute or Extend Cortex

1. Setup: [contributing/development.md](contributing/development.md)
2. Architecture: [architecture/overview.md](architecture/overview.md)
3. Guidelines: [contributing/contributing.md](contributing/contributing.md)
4. Test: [contributing/development.md](contributing/development.md) - Testing

#### Deploy Cortex

1. Installation: [README.md](../README.md) - Quick Start
2. Configuration: [guides/configuration.md](guides/configuration.md)
3. Storage: [architecture/storage.md](architecture/storage.md)
4. Troubleshooting: [guides/troubleshooting.md](guides/troubleshooting.md)

#### Troubleshoot Issues

1. Installation: [guides/troubleshooting.md](guides/troubleshooting.md) - Installation Issues
2. Runtime: [guides/troubleshooting.md](guides/troubleshooting.md) - Runtime Issues
3. Embeddings: [guides/troubleshooting.md](guides/troubleshooting.md) & [architecture/embeddings.md](architecture/embeddings.md)
4. Configuration: [guides/troubleshooting.md](guides/troubleshooting.md) - Configuration Issues
5. Performance: [guides/troubleshooting.md](guides/troubleshooting.md) - Performance Issues

---

## By Topic

### Installation & Setup

- [README.md](../README.md) - Installation instructions
- [contributing/development.md](contributing/development.md) - Development setup
- [guides/configuration.md](guides/configuration.md) - Configuration

### Commands & Usage

- [cli/reference.md](cli/reference.md) - All commands
- [README.md](../README.md) - Basic usage
- [cli/mcp.md](cli/mcp.md) - MCP tools/usage

### Memory Management

- [architecture/memory-model.md](architecture/memory-model.md) - Memory structure
- [guides/markdown-format.md](guides/markdown-format.md) - Import/export format
- [cli/reference.md](cli/reference.md) - CRUD commands

### Search & Discovery

- [architecture/memory-model.md](architecture/memory-model.md) - Memory types for search
- [architecture/embeddings.md](architecture/embeddings.md) - How search works
- [cli/reference.md](cli/reference.md) - Search command

### Storage & Performance

- [architecture/storage.md](architecture/storage.md) - Storage system
- [architecture/overview.md](architecture/overview.md) - Architecture overview
- [guides/troubleshooting.md](guides/troubleshooting.md) - Performance issues

### Embeddings & AI

- [architecture/embeddings.md](architecture/embeddings.md) - Vector system
- [architecture/overview.md](architecture/overview.md) - Embedding flow
- [guides/configuration.md](guides/configuration.md) - Embedding config

### Integration with AI Editors

- [cli/mcp.md](cli/mcp.md) - MCP integration guide
- [README.md](../README.md) - Quick start
- [guides/troubleshooting.md](guides/troubleshooting.md) - MCP issues

### Development & Contributing

- [contributing/development.md](contributing/development.md) - Development setup
- [contributing/contributing.md](contributing/contributing.md) - Contributing
- [architecture/overview.md](architecture/overview.md) - System design

### Troubleshooting

- [guides/troubleshooting.md](guides/troubleshooting.md) - Common issues
- [architecture/embeddings.md](architecture/embeddings.md) - Embedding issues
- [guides/configuration.md](guides/configuration.md) - Config help

---

## Document Relationships

```
README.md (Quick Start)
  ├─→ cli/reference.md (How to use)
  ├─→ architecture/memory-model.md (What to store)
  ├─→ guides/configuration.md (Setup)
  └─→ cli/mcp.md (Integration)

architecture/overview.md (System Design)
  ├─→ architecture/storage.md (Storage layer)
  ├─→ architecture/embeddings.md (Embeddings)
  └─→ contributing/development.md (Contribute)

agent/* (AI Agent Instructions)
  ├─→ agent/workflow.md (Build/test/lint)
  ├─→ agent/conventions.md (Code style)
  └─→ agent/tasks.md (Common tasks)

architecture/memory-model.md (Memory Structure)
  └─→ guides/markdown-format.md (Export format)

guides/configuration.md (Setup)
  ├─→ architecture/embeddings.md (Embeddings config)
  └─→ architecture/storage.md (Storage config)

guides/troubleshooting.md (Solutions)
  ├─→ architecture/embeddings.md (Embedding issues)
  ├─→ guides/configuration.md (Config help)
  └─→ contributing/development.md (Dev debugging)

contributing/development.md (Development)
  ├─→ contributing/contributing.md (Guidelines)
  └─→ architecture/overview.md (System design)
```

---

## Document Characteristics

### By Audience

**All Users:**
- [README.md](../README.md)
- [cli/reference.md](cli/reference.md)
- [guides/troubleshooting.md](guides/troubleshooting.md)

**Power Users:**
- [architecture/memory-model.md](architecture/memory-model.md)
- [guides/markdown-format.md](guides/markdown-format.md)
- [guides/configuration.md](guides/configuration.md)

**Developers:**
- [contributing/development.md](contributing/development.md)
- [architecture/overview.md](architecture/overview.md)
- [architecture/storage.md](architecture/storage.md)
- [architecture/embeddings.md](architecture/embeddings.md)
- [contributing/contributing.md](contributing/contributing.md)

**Operators/DevOps:**
- [guides/configuration.md](guides/configuration.md)
- [architecture/storage.md](architecture/storage.md)
- [architecture/embeddings.md](architecture/embeddings.md)
- [guides/troubleshooting.md](guides/troubleshooting.md)

### By Depth

**Quick Reference (5-10 min):**
- [README.md](../README.md) - Overview
- [cli/reference.md](cli/reference.md) - Command list
- Quick Reference sections above

**Practical Guides (15-30 min):**
- [architecture/memory-model.md](architecture/memory-model.md) - Best practices
- [guides/configuration.md](guides/configuration.md) - Setup
- [guides/troubleshooting.md](guides/troubleshooting.md) - Problem solving

**Deep Dives (30+ min):**
- [architecture/overview.md](architecture/overview.md) - System design
- [architecture/storage.md](architecture/storage.md) - Storage details
- [architecture/embeddings.md](architecture/embeddings.md) - Vectors in depth
- [contributing/development.md](contributing/development.md) - Full setup

---

## FAQ Pointers

**Q: How do I install Cortex?**
→ [README.md Quick Start](../README.md#quick-start)

**Q: What commands are available?**
→ [cli/reference.md](cli/reference.md)

**Q: How do I use it with Claude Code?**
→ [cli/mcp.md](cli/mcp.md)

**Q: How do I export/import memories?**
→ [guides/markdown-format.md](guides/markdown-format.md)

**Q: What is a good memory structure?**
→ [MEMORY_MODEL.md - Best Practices](architecture/memory-model.md#best-practices)

**Q: How does semantic search work?**
→ [architecture/embeddings.md](architecture/embeddings.md)

**Q: How is data stored?**
→ [architecture/storage.md](architecture/storage.md)

**Q: Something is not working, help!**
→ [guides/troubleshooting.md](guides/troubleshooting.md)

**Q: How do I contribute?**
→ [contributing/contributing.md](contributing/contributing.md)

**Q: Can I extend Cortex?**
→ [contributing/development.md](contributing/development.md) and [architecture/overview.md](architecture/overview.md)

---

## Recommended Reading Order

### For First-Time Users
1. [README.md](../README.md) - Get the big picture
2. [cli/reference.md](cli/reference.md) - Learn basic commands
3. [architecture/memory-model.md](architecture/memory-model.md) - Understand memory types
4. [cli/mcp.md](cli/mcp.md) (if using Claude Code/Cursor)

### For Power Users
1. [cli/reference.md](cli/reference.md) - Deep dive into commands
2. [architecture/memory-model.md](architecture/memory-model.md) - Master best practices
3. [guides/markdown-format.md](guides/markdown-format.md) - Bulk operations
4. [guides/configuration.md](guides/configuration.md) - Advanced setup

### For Developers
1. [architecture/overview.md](architecture/overview.md) - System design
2. [contributing/development.md](contributing/development.md) - Setup environment
3. [architecture/storage.md](architecture/storage.md) - Storage internals
4. [architecture/embeddings.md](architecture/embeddings.md) - Vector system
5. [contributing/contributing.md](contributing/contributing.md) - How to contribute

### For Operations/Deployment
1. [README.md](../README.md) - Overview
2. [guides/configuration.md](guides/configuration.md) - Setup
3. [architecture/storage.md](architecture/storage.md) - Storage management
4. [architecture/embeddings.md](architecture/embeddings.md) - Ollama setup
5. [guides/troubleshooting.md](guides/troubleshooting.md) - Operations

---

## Document Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| [README.md](../README.md) | ✅ Current | 2024-01 |
| [agent/workflow.md](agent/workflow.md) | ✅ New | 2026-02 |
| [agent/conventions.md](agent/conventions.md) | ✅ New | 2026-02 |
| [agent/tasks.md](agent/tasks.md) | ✅ New | 2026-02 |
| [architecture/overview.md](architecture/overview.md) | ✅ Current | 2024-01 |
| [guides/configuration.md](guides/configuration.md) | ✅ Updated | 2025-02 |
| [contributing/contributing.md](contributing/contributing.md) | ✅ Current | 2024-01 |
| [cli/mcp.md](cli/mcp.md) | ✅ Current | 2024-01 |
| [cli/reference.md](cli/reference.md) | ✅ New | 2024-01 |
| [architecture/memory-model.md](architecture/memory-model.md) | ✅ New | 2024-01 |
| [guides/markdown-format.md](guides/markdown-format.md) | ✅ New | 2024-01 |
| [architecture/storage.md](architecture/storage.md) | ✅ New | 2024-01 |
| [architecture/embeddings.md](architecture/embeddings.md) | ✅ Updated | 2025-02 |
| [contributing/development.md](contributing/development.md) | ✅ New | 2024-01 |
| [guides/troubleshooting.md](guides/troubleshooting.md) | ✅ New | 2024-01 |
| [INDEX.md](INDEX.md) | ✅ Updated | 2025-02 |

---

## How to Use This Index

1. **Know what to learn?** → Go directly to that document
2. **Not sure where to start?** → Check "By Use Case" section
3. **Looking for specific topic?** → Check "By Topic" section
4. **Want a guided path?** → Follow "Recommended Reading Order"
5. **Stuck on a problem?** → Go to [guides/troubleshooting.md](guides/troubleshooting.md)

---

## Navigation

**You are here:** Documentation Index

- [Back to README](../README.md)
- [All Documentation](.)

For issues or corrections to documentation, file an issue at:
https://github.com/cortex-ai/cortex-ai/issues
