# Cortex - Development Guide

Guide for setting up the development environment and contributing to Cortex.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Building](#building)
- [Testing](#testing)
- [Code Style](#code-style)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)
- [Debugging](#debugging)

---

## Prerequisites

### Required

- **Go 1.24+** - Download from https://golang.org/dl/
- **Git** - For version control
- **Ollama** - For embeddings (https://ollama.ai)

### Optional but Recommended

- **golangci-lint** - Linting tool
- **Make** - Build automation
- **Delve** - Go debugger

### Verify Installation

```bash
go version          # Should show Go 1.24+
git version         # Should show git 2.x+
ollama -v           # Should show Ollama version
make --version      # Should show Make version
```

---

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/cortex-ai/cortex-ai.git
cd cortex-ai
```

### 2. Download Dependencies

```bash
make deps
# or
go mod download
```

### 3. Install Embedding Model

```bash
ollama pull nomic-embed-text
```

### 4. Verify Setup

```bash
make build
./bin/cortex --version
```

---

## Building

### Build Commands

```bash
# Build binary to ./bin/cortex
make build

# Install to $GOBIN (usually ~/go/bin)
make install

# Build with specific output path
go build -o myapp cmd/cortex/main.go

# Build with version info
go build -ldflags="-X main.Version=v1.0.0" cmd/cortex/main.go
```

### Output

```
Build successful!
Binary: ./bin/cortex
```

### Run Commands

```bash
# Using make
make build
./bin/cortex --help

# Using go
go run cmd/cortex/main.go --help

# After install
cortex --help
```

---

## Testing

### Run All Tests

```bash
# Run all tests
make test

# Run with coverage
go test -cover ./...

# Generate coverage report
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Run Specific Tests

```bash
# Test specific package
go test ./internal/memory/...

# Test specific function
go test -run TestCreate ./internal/memory/...

# Run with verbose output
go test -v ./...
```

### Race Detector

```bash
# Run all tests with race detector
make test-race

# Or manually
go test -race ./...
```

### Benchmarks

```bash
# Run benchmarks
go test -bench=. ./internal/storage/...

# Run with memory stats
go test -bench=. -benchmem ./internal/storage/...
```

### Test Structure

Tests are colocated with source files:

```
internal/
├── memory/
│   ├── memory.go
│   ├── memory_test.go
│   ├── service.go
│   └── service_test.go
├── storage/
│   ├── storage.go
│   ├── storage_test.go
│   ├── gob.go
│   └── gob_test.go
```

---

## Code Style

### Formatting

```bash
# Format all Go files
gofmt -s -w .

# Or with imports
goimports -w .
```

### Linting

```bash
# Run linter
make lint

# Or manually
golangci-lint run

# Fix some issues automatically
golangci-lint run --fix
```

### Code Guidelines

Follow [Effective Go](https://golang.org/doc/effective_go):

- **Naming:** Use camelCase for variables/functions, PascalCase for types
- **Comments:** Comment exported functions and types
- **Error handling:** Always check and wrap errors with context
- **Interfaces:** Keep interfaces small and focused
- **Concurrency:** Use goroutines carefully, protect shared state

### Example

```go
// Package memory provides memory storage and retrieval.
package memory

import (
    "context"
    "fmt"
)

// Memory represents a single piece of knowledge.
type Memory struct {
    ID    string
    Title string
    // ...
}

// Create stores a new memory.
func (s *Service) Create(ctx context.Context, input CreateInput) (*Memory, error) {
    if err := input.Validate(); err != nil {
        return nil, fmt.Errorf("invalid input: %w", err)
    }
    // ... implementation
}
```

---

## Project Structure

### Directory Layout

```
cortex-ai/
├── cmd/
│   └── cortex/
│       └── main.go              # Entry point
├── internal/
│   ├── cli/                     # Cobra commands
│   │   ├── create.go
│   │   ├── search.go
│   │   ├── list.go
│   │   └── ...
│   ├── memory/                  # Domain model & service
│   │   ├── memory.go
│   │   ├── service.go
│   │   └── ...
│   ├── storage/                 # Persistence layer
│   │   ├── storage.go (interface)
│   │   ├── gob.go
│   │   └── ...
│   ├── embeddings/              # Vector generation
│   │   ├── embedder.go (interface)
│   │   ├── ollama.go
│   │   └── ...
│   ├── search/                  # Similarity algorithms
│   │   └── cosine.go
│   ├── config/                  # Configuration
│   │   └── config.go
│   └── mcp/                     # MCP server
│       ├── server.go
│       ├── transport.go
│       └── ...
├── pkg/
│   ├── markdown/                # Import/export
│   │   └── ...
│   └── json/                    # JSON format
│       └── ...
├── docs/                        # Documentation
├── Makefile                     # Build automation
├── go.mod / go.sum              # Dependencies
└── README.md
```

### Package Relationships

```
cli/          ← Cobra commands
  └→ memory/  ← Business logic
       ├→ storage/    ← Persistence
       ├→ embeddings/ ← Vector generation
       └→ search/     ← Similarity

mcp/          ← MCP server
  └→ memory/  ← Business logic
```

---

## Common Tasks

### Add a New CLI Command

1. **Create command file:**

```go
// internal/cli/mycommand.go
package cli

import "github.com/spf13/cobra"

var MyCmd = &cobra.Command{
    Use:   "mycommand",
    Short: "Do something",
    RunE: func(cmd *cobra.Command, args []string) error {
        // Implementation
        return nil
    },
}

func init() {
    MyCmd.Flags().StringP("flag", "f", "", "Flag description")
}
```

2. **Register command in root.go:**

```go
// internal/cli/root.go
func init() {
    rootCmd.AddCommand(MyCmd)
}
```

3. **Add tests:**

```go
// internal/cli/mycommand_test.go
func TestMyCommand(t *testing.T) {
    // Test implementation
}
```

### Add a New Storage Backend

1. **Implement Storage interface:**

```go
// internal/storage/mystorage.go
type MyStorage struct {
    // fields
}

func (s *MyStorage) Save(ctx context.Context, memory *memory.Memory) error {
    // Implement
}

// Implement remaining interface methods...
```

2. **Add factory function:**

```go
func NewMyStorage(path string) (*MyStorage, error) {
    // Initialize
    return &MyStorage{...}, nil
}
```

3. **Register in config:**

```go
// internal/config/storage.go
case "mystorage":
    return storage.NewMyStorage(opts.Path)
```

### Add a Test

```go
package mypackage

import "testing"

func TestMyFunction(t *testing.T) {
    // Arrange
    input := "test"

    // Act
    result, err := MyFunction(input)

    // Assert
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if result != expected {
        t.Errorf("got %v, want %v", result, expected)
    }
}
```

---

## Debugging

### Verbose Logging

Run commands with debug logging:

```bash
# Set log level via env var
CORTEX_LOG_LEVEL=debug cortex search "query"

# Or flag
cortex search "query" --log debug
```

### Print Debugging

Add temporary debug output:

```go
fmt.Printf("DEBUG: value = %v\n", value)
```

### Delve Debugger

```bash
# Install
go install github.com/go-delve/delve/cmd/dlv@latest

# Debug a test
dlv test ./internal/memory -- -test.run TestCreate

# Debug the binary
dlv debug cmd/cortex/main.go
(dlv) break main.main
(dlv) continue
(dlv) next
```

### Inspect Memory

```go
// Pretty print data
import "encoding/json"

b, _ := json.MarshalIndent(memory, "", "  ")
fmt.Println(string(b))
```

---

## Continuous Integration

The project uses GitHub Actions for CI/CD:

```yaml
# .github/workflows/test.yml
- Build the project
- Run tests
- Run linter
- Check coverage
```

View results on the GitHub Actions tab.

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contributing guidelines
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - CLI reference
