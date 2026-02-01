# Contributing to Cortex

Thank you for your interest in contributing to Cortex! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## Getting Started

### Prerequisites

- Go 1.21 or later
- Ollama (for embeddings)
- golangci-lint (for linting)

### Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/cortex-ai/cortex-ai.git
   cd cortex-ai
   ```

2. Install dependencies:
   ```bash
   go mod download
   ```

3. Install Ollama and pull the embedding model:
   ```bash
   ollama pull nomic-embed-text
   ```

4. Build the project:
   ```bash
   make build
   ```

5. Run tests:
   ```bash
   make test
   ```

## Development Workflow

### Branching

- Create a feature branch from `main`
- Use descriptive branch names: `feature/add-sqlite-storage`, `fix/search-performance`

### Making Changes

1. Write code following Go conventions
2. Add tests for new functionality
3. Update documentation as needed
4. Run linter: `make lint`
5. Run tests: `make test`
6. Run tests with race detector: `make test-race`

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
feat(storage): add SQLite backend support

Implement SQLite storage as an alternative to Gob storage.
Includes schema migration and connection pooling.

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
cortex-ai/
├── cmd/
│   ├── cortex/         # CLI entry point
│   └── cortex-mcp/     # MCP server entry point
├── internal/
│   ├── cli/            # CLI commands
│   ├── config/         # Configuration management
│   ├── embeddings/     # Embedding providers
│   ├── mcp/            # MCP protocol implementation
│   ├── memory/         # Core memory domain
│   ├── search/         # Vector search algorithms
│   └── storage/        # Storage backends
├── pkg/
│   └── markdown/       # Markdown import/export
└── docs/               # Documentation
```

## Testing

### Running Tests

```bash
# All tests
make test

# With race detector
make test-race

# Specific package
go test -v ./internal/memory/...

# With coverage
go test -cover ./...
```

### Writing Tests

- Use table-driven tests where appropriate
- Mock external dependencies
- Test edge cases and error conditions
- Aim for 80%+ coverage

### Benchmarks

```bash
# Run benchmarks
go test -bench=. ./internal/search/...

# With memory allocation stats
go test -bench=. -benchmem ./internal/storage/...
```

## Documentation

- Update README.md for user-facing changes
- Add package-level documentation in Go files
- Update docs/ for detailed guides
- Include examples in documentation

## Reporting Issues

When reporting issues, please include:

1. Cortex version
2. Go version
3. Operating system
4. Steps to reproduce
5. Expected vs actual behavior
6. Error messages or logs

## Feature Requests

For feature requests:

1. Check existing issues first
2. Describe the use case
3. Explain the expected behavior
4. Consider implementation approaches

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue for questions or reach out to maintainers.

Thank you for contributing!
