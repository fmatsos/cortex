# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2024-01-31

### Added

- **Core Memory System**
  - Memory model with types: solution, issue, analysis, rule, any
  - Memory service with CRUD operations
  - Support for tags and metadata
  - Obsolete marking for soft deletion

- **Semantic Search**
  - Vector embeddings via Ollama (nomic-embed-text)
  - Cosine similarity search
  - Configurable top-K and minimum score filtering
  - Type-based filtering

- **Storage Backends**
  - Gob-based file storage with vector index
  - Thread-safe concurrent access
  - Persistent vector index for fast search

- **CLI Commands**
  - `cortex create` - Create new memories
  - `cortex search` - Semantic search
  - `cortex list` - List memories with filters
  - `cortex delete` - Delete memories
  - `cortex export` - Export to Markdown
  - `cortex import` - Import from Markdown
  - `cortex config` - Configuration management

- **Markdown Import/Export**
  - YAML frontmatter support
  - Round-trip preservation
  - Synthesis export for search results
  - Batch import with validation

- **Configuration System**
  - YAML config file support
  - Environment variable overrides (CORTEX_*)
  - XDG-compliant paths
  - Sensible defaults

- **MCP Integration**
  - Model Context Protocol server
  - Tools: cortex_search, cortex_create, cortex_list, cortex_get
  - Claude Code and Cursor integration

- **Testing & Quality**
  - 80%+ test coverage
  - Race condition testing
  - Performance benchmarks
  - golangci-lint configuration

### Changed

- N/A (initial release)

### Deprecated

- N/A (initial release)

### Removed

- N/A (initial release)

### Fixed

- N/A (initial release)

### Security

- No known security issues

---

## Version History

- **1.0.0** - Initial release with full feature set
