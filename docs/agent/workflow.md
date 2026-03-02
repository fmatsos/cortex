# Agent Workflow

## Pre-Commit Checklist (mandatory, in order)

```bash
make fmt    # 1. Format – fixes formatting issues
make lint   # 2. Lint  – keep golangci-lint v2 in config
make test   # 3. Test  – all tests must pass
make build  # 4. Build – verifies compilation
```

If any step fails, fix and restart from step 1. **Do not commit until all four are green.**

## Common Make Targets

```bash
make build       # Build to ./bin/cortex
make install     # Install to $GOBIN
make test        # Run all tests (verbose + coverage)
make test-race   # Run tests with race detector
make lint        # golangci-lint run ./...
make fmt         # go fmt ./...
make deps        # go mod download + tidy
make clean       # Remove build artifacts
```

## Running Tests

```bash
# Single package
go test ./internal/memory/...
go test ./internal/storage/...
go test ./internal/consolidation/...

# Single test by name
go test ./internal/memory -run TestCreate
go test ./internal/storage -run "TestGobStorage/.*"

# No cache
go test ./internal/memory -run TestCreate -count=1

# Benchmarks
go test ./internal/storage -bench=. -count=1
go test ./internal/search  -bench=BenchmarkCosine -count=1
```

## Environment Variables (quick reference)

```bash
CORTEX_STORAGE_PATH=.agents/cortex
CORTEX_EMBEDDINGS_ENDPOINT=http://localhost:11434
CORTEX_EMBEDDINGS_MODEL=nomic-embed-text
CORTEX_EMBEDDINGS_TIMEOUT=30s
CORTEX_SEARCH_TOP_K=5
CORTEX_SEARCH_MIN_SCORE=0.5
CORTEX_CONSOLIDATION_SIMILARITY_THRESHOLD=0.85
CORTEX_CONSOLIDATION_AUTO_TRANSFER=true
CORTEX_AUTOPRUNE_DUPLICATES_THRESHOLD=0.92
CORTEX_AUTOPRUNE_EPISODIC_RETENTION_DAYS=90
CORTEX_AUTOPRUNE_SEMANTIC_MERGE_THRESHOLD=0.88
CORTEX_SESSION_AUTO_DERIVE=true
CORTEX_SESSION_PATTERN_TYPE=prefix
CORTEX_SESSION_MAX_SEGMENTS=2
CORTEX_SESSION_PREFIX=session-
CORTEX_SESSION_SEPARATOR=-
```
