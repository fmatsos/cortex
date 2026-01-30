# Cortex AI

**Cortex AI** is a CLI tool written in Go that provides persistent memory for AI agentic coding tools. It enables LLMs to recall past problems, solutions, and project-specific rules across sessions.

## Overview

When working with AI coding assistants like Claude Code, Cursor, or Windsurf, context is often lost between sessions. Cortex AI solves this by providing a local vector database that stores "memories" - structured knowledge that can be retrieved semantically.

The tool follows a similar approach to [grepai](https://github.com/yoanbernabeu/grepai): **search by intent**, local operation via **Ollama**, and vector embeddings for semantic matching.

## Key Features

- **Memory Creation** - Store structured memories on user request (problems encountered, solutions found, project rules)
- **Vector Search** - Semantic search across all saved memories using natural language queries
- **Memory Deletion** - Remove obsolete or outdated memories
- **Memory Listing** - View all existing memories
- **Markdown Export** - Export memories to Markdown format for sharing or backup
- **Markdown Import** - Import memories written in Markdown format

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│   Cortex AI     │────▶│  Vector Store   │
│  (via Skill)    │◀────│     CLI         │◀────│  (Gob/SQLite)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │     Ollama      │
                        │  (Embeddings)   │
                        └─────────────────┘
```

1. **User triggers memory creation** - When the user asks the LLM to remember something, a memory is created
2. **Embedding generation** - The memory content is converted to a vector embedding via Ollama (local)
3. **Vector storage** - The embedding and metadata are stored in the vector database
4. **Semantic retrieval** - The LLM can freely search memories by intent/meaning, not just keywords

## Storage Backends

| Backend | Description | Use Case |
|---------|-------------|----------|
| **Gob** (default) | File-based storage using Go's gob encoding | Simple setup, single user, small to medium datasets |
| **SQLite** | Embedded SQL database | Better querying, larger datasets, potential for advanced features |

## CLI Commands

```bash
# Create a new memory
cortex create --title "Auth fix" --content "JWT refresh tokens must be rotated..."

# Search memories semantically
cortex search "authentication issues"

# List all memories
cortex list

# Delete an obsolete memory
cortex delete <memory-id>

# Export memories to Markdown
cortex export --output memories.md

# Import memories from Markdown
cortex import --file memories.md
```

## Integration with AI Agents

Cortex AI is designed to be used as a **Skill** (or MCP tool) for AI coding assistants:

```yaml
# Example skill definition
name: cortex-memory
description: Search and manage project memories
commands:
  - search: Query memories by intent
  - create: Store a new memory (user-initiated)
```

### Typical Workflow

1. **Problem encountered** - User asks LLM to remember a bug fix or solution
2. **Memory stored** - `cortex create` stores the memory with embeddings
3. **Future session** - LLM encounters similar issue
4. **Semantic search** - LLM uses `cortex search` to find relevant past experiences
5. **Informed solution** - LLM applies learned knowledge to current problem

## Local-First & Privacy

Like grepai, Cortex AI is designed to run **entirely locally**:

- **Ollama** for embeddings - No data sent to external APIs
- **Local storage** - All memories stored on your machine
- **No telemetry** - Your project knowledge stays private

## Requirements

- Go 1.21+
- Ollama with an embedding model (recommended: `nomic-embed-text`)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/cortex-ai.git
cd cortex-ai

# Build
go build -o cortex ./cmd/cortex

# Or install directly
go install ./cmd/cortex
```

## Configuration

```yaml
# ~/.config/cortex-ai/config.yaml
storage:
  backend: gob  # or "sqlite"
  path: ~/.local/share/cortex-ai/memories

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434

search:
  top_k: 5
  min_score: 0.7
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - See [LICENSE](LICENSE) for details.
