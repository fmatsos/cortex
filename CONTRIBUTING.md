# Contributing to Cortex

Thank you for your interest in contributing to Cortex! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## Getting Started

### Prerequisites

- **Python 3.12+** — [Install Python](https://python.org/downloads/)
- **uv** — Fast Python package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Ollama** — For embeddings: [Install Ollama](https://ollama.ai)

### Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/fmatsos/cortex.git
   cd cortex
   ```

2. Install dependencies:
   ```bash
   uv sync --all-groups
   ```

3. Install Ollama and pull the embedding model:
   ```bash
   ollama pull nomic-embed-text
   ```

4. Verify setup:
   ```bash
   uv run python -c "import cortex; print('OK')"
   uv run pytest tests/ -v
   ```

## Development Workflow

### Branching

- Create a feature branch from `main`
- Use descriptive branch names: `feature/add-sqlite-storage`, `fix/search-performance`

### Making Changes

1. Write code following Python conventions (PEP 8, enforced by ruff)
2. Add tests for new functionality
3. Update documentation as needed
4. Format code: `uv run ruff format src/ tests/`
5. Run linter: `uv run ruff check src/ tests/`
6. Run tests: `uv run pytest tests/ -v`

### Pre-Commit Checklist

Before committing, run in order:

```bash
uv run ruff format src/ tests/   # 1. Format
uv run ruff check src/ tests/    # 2. Lint
uv run pytest tests/ -v          # 3. Test
```

All three steps must pass. Fix any failures and restart from step 1.

### Commit Messages

Follow conventional commit format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `test`: Tests
- `refactor`: Code refactoring
- `chore`: Maintenance tasks

Example:
```
feat(storage): add prefix-based ID matching

Allow memory IDs to be specified by prefix instead of full UUID.
Raises AmbiguousIDError when prefix matches multiple memories.

Closes #42
```

### Pull Requests

1. Ensure all tests pass
2. Update CHANGELOG.md if applicable
3. Request review from maintainers
4. Address review feedback
5. Squash commits if requested

## Project Structure

```
cortex/
├── pyproject.toml          # Package metadata, dependencies, tool config
├── uv.lock                 # Locked dependency versions
├── .python-version         # Python version pin (3.12)
├── src/
│   └── cortex/
│       ├── __init__.py
│       ├── __main__.py         # Entry point: main() → app()
│       ├── models/             # Pydantic v2 models
│       │   ├── memory.py       # Memory, MemoryContext, MemoryLevel
│       │   └── results.py      # SearchResult, ConsolidateResult, etc.
│       ├── config/
│       │   └── settings.py     # pydantic-settings: YAML + CORTEX_* env vars
│       ├── storage/
│       │   ├── base.py         # Storage Protocol (ABC)
│       │   └── chroma.py       # ChromaDB implementation
│       ├── embeddings/
│       │   ├── base.py         # Embedder Protocol
│       │   └── ollama.py       # httpx client, chunking, LRU cache
│       ├── search/
│       │   └── cosine.py       # cosine_similarity(a, b) → float
│       ├── memory/
│       │   └── service.py      # MemoryService (orchestrates storage + embedder)
│       ├── consolidation/
│       │   ├── service.py      # ConsolidationService
│       │   └── autoprune.py    # AutopruneService
│       ├── markdown/
│       │   ├── export.py
│       │   └── import_.py
│       ├── session.py          # Session ID derivation from git branch
│       ├── cli/                # Typer commands
│       │   ├── app.py          # Root app + shared helpers
│       │   ├── create.py
│       │   ├── search.py
│       │   └── ...
│       └── mcp/
│           ├── server.py       # FastMCP server
│           └── tools/          # 13 MCP tool handlers
└── tests/
    ├── conftest.py             # Fixtures: MockEmbedder, temp ChromaDB, CLI runner
    ├── test_models.py
    ├── test_storage.py
    ├── test_memory_service.py
    ├── test_consolidation.py
    ├── test_autoprune.py
    ├── test_markdown.py
    └── test_cli.py
```

## Testing

### Running Tests

```bash
# All tests
uv run pytest tests/ -v

# Specific test file
uv run pytest tests/test_storage.py -v

# Specific test by name
uv run pytest tests/test_memory_service.py -k "test_create"

# With coverage
uv run pytest tests/ --cov=src/cortex --cov-report=term-missing
```

### Writing Tests

- Use `pytest` fixtures for shared setup
- Mock external dependencies (Ollama, ChromaDB) in unit tests
- Use `MockEmbedder` from `conftest.py` for deterministic embeddings
- Test edge cases and error conditions
- Aim for 80%+ coverage

### Test Fixtures

Key fixtures available in `tests/conftest.py`:

```python
# Deterministic mock embedder (no Ollama needed)
mock_embedder: MockEmbedder

# Temporary in-memory ChromaDB storage
chroma_storage: ChromaStorage

# Typer CLI test runner
cli_runner: CliRunner
```

## Documentation

- Update `README.md` for user-facing changes
- Update files in `.agents/instructions/` for architecture/development docs
  (these symlink to `docs/`, `.github/instructions/`, and `.claude/rules/`)
- Include examples in documentation

## Reporting Issues

When reporting issues, please include:

1. Cortex version (`cortex --version`)
2. Python version (`python --version`)
3. Operating system
4. Steps to reproduce
5. Expected vs actual behavior
6. Error messages or logs

Enable debug logging for more detail:

```bash
cortex --log-level debug <command>
```

## Feature Requests

For feature requests:

1. Check existing issues first
2. Describe the use case
3. Explain the expected behavior
4. Consider implementation approaches

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

## Questions?

Feel free to open an issue for questions or reach out to maintainers.

Thank you for contributing!
