---
applyTo: "**"
---

# Cortex - Development Guide

Guide for setting up the development environment and contributing to Cortex.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the CLI](#running-the-cli)
- [Testing](#testing)
- [Code Style](#code-style)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)
- [Debugging](#debugging)

---

## Prerequisites

### Required

- **Python 3.12+** — [Download from python.org](https://python.org/downloads/)
- **uv** — Fast Python package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Git** — For version control
- **Ollama** — For embeddings ([Install Ollama](https://ollama.ai))

### Verify Installation

```bash
python3 --version      # Should show 3.12+
uv --version           # Should show uv 0.x
git version            # Should show git 2.x+
ollama -v              # Should show Ollama version
```

---

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/fmatsos/cortex.git
cd cortex
```

### 2. Install Dependencies

```bash
uv sync --all-groups
```

This creates a `.venv/` directory with all dependencies (including dev dependencies).

### 3. Install Embedding Model

```bash
ollama pull nomic-embed-text
```

### 4. Verify Setup

```bash
uv run python -c "import cortex; print('OK')"
uv run pytest tests/ -v
```

---

## Running the CLI

```bash
# Run via uv (development mode)
uv run python -m cortex --help

# Or activate venv and run directly
source .venv/bin/activate
cortex --help

# Run as if installed from PyPI
uvx --from . cortex --help
```

---

## Testing

### Run All Tests

```bash
# Run all tests with verbose output
uv run pytest tests/ -v

# Run with coverage report
uv run pytest tests/ --cov=src/cortex --cov-report=term-missing

# Run without Ollama (uses MockEmbedder)
uv run pytest tests/ -v  # all tests use mocks by default
```

### Run Specific Tests

```bash
# Test specific file
uv run pytest tests/test_storage.py -v

# Test specific function
uv run pytest tests/test_memory_service.py::TestMemoryService::test_create -v

# Test by keyword
uv run pytest tests/ -k "search" -v
```

### Test Structure

Tests live in `tests/`, separate from source:

```
tests/
├── conftest.py          # Shared fixtures
├── test_models.py
├── test_storage.py
├── test_embeddings.py
├── test_memory_service.py
├── test_consolidation.py
├── test_autoprune.py
├── test_markdown.py
└── test_cli.py
```

Key fixtures in `conftest.py`:

```python
# Deterministic mock embedder (no Ollama needed)
@pytest.fixture
def mock_embedder() -> MockEmbedder: ...

# Temporary ChromaDB storage (auto-cleaned)
@pytest.fixture
def chroma_storage(tmp_path) -> ChromaStorage: ...

# Typer CLI test runner
@pytest.fixture
def cli_runner() -> CliRunner: ...
```

---

## Code Style

### Formatting and Linting

```bash
# Format all Python files
uv run ruff format src/ tests/

# Lint (check for errors)
uv run ruff check src/ tests/

# Lint with auto-fix
uv run ruff check --fix src/ tests/
```

### Pre-Commit Checklist

Run in order before every commit:

```bash
uv run ruff format src/ tests/   # 1. Format
uv run ruff check src/ tests/    # 2. Lint
uv run pytest tests/ -v          # 3. Test
```

All three must pass. Fix failures, then restart from step 1.

### Code Guidelines

- **Naming:** `snake_case` for variables/functions, `PascalCase` for classes
- **Errors:** Library code raises exceptions; CLI uses `typer.echo(..., err=True)`
- **Output:** Always use `typer.echo()` in CLI — never `print()`
- **Protocols:** Do not duplicate the `Embedder` or `Storage` protocols
- **Mocks:** Implement ALL methods when mocking a Protocol

---

## Project Structure

### Directory Layout

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
│       │   ├── app.py          # Root app + shared init helpers
│       │   ├── create.py
│       │   ├── search.py
│       │   ├── list_.py
│       │   ├── get.py
│       │   ├── delete.py
│       │   ├── consolidate.py
│       │   ├── transfer_working.py
│       │   ├── autoprune.py
│       │   ├── export_.py
│       │   ├── import_.py
│       │   ├── stats.py
│       │   ├── config_.py
│       │   └── mcp_.py
│       └── mcp/
│           ├── server.py       # FastMCP server setup
│           └── tools/          # 13 MCP tool handlers
└── tests/
    ├── conftest.py
    └── test_*.py
```

### Module Relationships

```
cli/                ← Typer commands
  └→ memory/        ← Business logic
       ├→ storage/      ← ChromaDB persistence
       ├→ embeddings/   ← Ollama vector generation
       └→ search/       ← Cosine similarity

mcp/                ← FastMCP server
  └→ memory/        ← Business logic
```

---

## Common Tasks

### Add a New CLI Command

1. **Create command file** in `src/cortex/cli/`:

```python
# src/cortex/cli/mycommand.py
import typer
from cortex.cli.app import get_storage, get_embedder

app = typer.Typer()

@app.command()
def mycommand(
    flag: str = typer.Option(..., "--flag", "-f", help="Flag description"),
) -> None:
    storage = get_storage()
    try:
        # Implementation
        typer.echo("Done")
    finally:
        storage.close()
```

2. **Register in `src/cortex/cli/app.py`:**

```python
from cortex.cli.mycommand import app as mycommand_app
app.add_typer(mycommand_app, name="mycommand")
```

3. **Add tests in `tests/test_cli.py`.**

### Add a New Storage Backend

1. **Implement the `Storage` Protocol** from `cortex.storage.base`:

```python
# src/cortex/storage/mystorage.py
from cortex.storage.base import Storage
from cortex.models.memory import Memory

class MyStorage:
    def save(self, memory: Memory) -> None: ...
    def get(self, memory_id: str) -> Memory: ...
    def list(self, **kwargs) -> list[Memory]: ...
    def delete(self, memory_id: str) -> None: ...
    def update(self, memory: Memory) -> None: ...
    def search_all_layers(self, vector, **kwargs): ...
    def transfer_working_to_episodic(self, session_id: str) -> int: ...
    def get_embedding(self, memory_id: str) -> list[float]: ...
    def close(self) -> None: ...
```

2. **Register in `src/cortex/cli/app.py`** `get_storage()` factory.

### Add a Test

```python
# tests/test_myfeature.py
import pytest
from cortex.models.memory import Memory, MemoryLevel

class TestMyFeature:
    def test_something(self, chroma_storage, mock_embedder):
        # Arrange
        memory = Memory(
            title="Test memory",
            content="Test content here.",
            level=MemoryLevel.EPISODIC,
        )
        # Act
        chroma_storage.save(memory)
        # Assert
        result = chroma_storage.get(memory.id)
        assert result.title == "Test memory"
```

---

## Debugging

### Verbose Logging

```bash
# Set log level via flag
cortex --log-level debug search "query"

# Or via environment variable
CORTEX_LOG_LEVEL=debug cortex search "query"
```

### Print Debugging

```python
import json
print(json.dumps(memory.model_dump(), indent=2, default=str))
```

### Inspect ChromaDB Directly

```python
import chromadb
client = chromadb.PersistentClient(path=".agents/cortex")
col = client.get_collection("cortex_episodic")
print(col.count())
print(col.get(limit=5))
```

---

## Continuous Integration

GitHub Actions runs on every push and PR:

```yaml
# .github/workflows/ci.yml
- uv run ruff format --check src/ tests/
- uv run ruff check src/ tests/
- uv run pytest tests/ -v
```

View results on the GitHub Actions tab.

---

## Building and Publishing

```bash
# Build wheel and sdist
uv build

# Test install locally
pip install dist/cortex_memory-*.whl

# Publish to PyPI (CI only, via OIDC)
# Triggered automatically on git tag v*.*.*
```

---

## Environment Variables (quick reference)

```bash
CORTEX_STORAGE__PATH=.agents/cortex
CORTEX_EMBEDDINGS__ENDPOINT=http://localhost:11434
CORTEX_EMBEDDINGS__MODEL=nomic-embed-text
CORTEX_EMBEDDINGS__TIMEOUT=30
CORTEX_SEARCH__TOP_K=5
CORTEX_SEARCH__MIN_SCORE=0.5
CORTEX_CONSOLIDATION__SIMILARITY_THRESHOLD=0.85
CORTEX_AUTOPRUNE__DUPLICATES_THRESHOLD=0.92
CORTEX_AUTOPRUNE__EPISODIC_RETENTION_DAYS=90
CORTEX_AUTOPRUNE__SEMANTIC_MERGE_THRESHOLD=0.88
CORTEX_SESSION__AUTO_DERIVE=true
CORTEX_SESSION__MAX_SEGMENTS=2
CORTEX_SESSION__PREFIX=session-
CORTEX_SESSION__SEPARATOR=-
```

Note: `__` is the nested delimiter for pydantic-settings (e.g. `CORTEX_EMBEDDINGS__MODEL`).

---

## Related Documentation

- [Architecture](../architecture/overview.md) - System architecture
- [Contributing](contributing.md) - Contributing guidelines
- [CLI Reference](../cli/reference.md) - CLI reference

---

## Tooling Fallbacks

When semantic tools are unavailable in the environment (for example `grepai` or `cortex` is not installed), document the failure and use deterministic fallbacks:

- Use `rg` for exact code discovery and file targeting.
- Use direct GitHub API queries (for PR comments/review context) when web context is needed.
- Continue the workflow, and explicitly note the limitation in task validation output.
