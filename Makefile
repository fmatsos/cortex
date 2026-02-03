.PHONY: build test lint install install-man clean help

# Variables
BINARY_NAME=cortex
MAIN_PATH=./cmd/cortex
BUILD_DIR=./bin
VERSION?=dev
LDFLAGS=-ldflags "-X main.Version=$(VERSION)"

# Man page installation directory
# Default to user-local share directory, can be overridden with MANDIR
MANDIR?=$(HOME)/.local/share/man

# Default target
help:
	@echo "Cortex AI - CLI tool for persistent AI agent memory"
	@echo ""
	@echo "Available targets:"
	@echo "  build       - Build the cortex binary"
	@echo "  install     - Build and install cortex to GOBIN (includes man page)"
	@echo "  install-man - Install man page only"
	@echo "  test        - Run all tests"
	@echo "  test-race   - Run tests with race detector"
	@echo "  lint        - Run linter"
	@echo "  clean       - Remove build artifacts"
	@echo "  help        - Show this help message"
	@echo ""
	@echo "Environment variables:"
	@echo "  MANDIR      - Man page install directory (default: ~/.local/share/man)"

# Build the CLI binary
build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	@go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) $(MAIN_PATH)
	@echo "Build complete: $(BUILD_DIR)/$(BINARY_NAME)"

# Install CLI to GOBIN and man page
install: install-man
	@echo "Installing $(BINARY_NAME)..."
	@go install $(LDFLAGS) $(MAIN_PATH)
	@echo "Installation complete"

# Install man page only
install-man:
	@echo "Installing man page to $(MANDIR)/man1..."
	@mkdir -p $(MANDIR)/man1
	@cp man/man1/cortex.1 $(MANDIR)/man1/cortex.1
	@echo "Man page installed. You may need to run 'mandb' or add $(MANDIR) to MANPATH"

# Run tests
test:
	@echo "Running tests..."
	@go test -v -cover ./...

# Run tests with race detector
test-race:
	@echo "Running tests with race detector..."
	@go test -v -race ./...

# Run linter
lint:
	@echo "Running linter..."
	@which golangci-lint > /dev/null || (echo "golangci-lint not installed. Install with: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest" && exit 1)
	@golangci-lint run ./...

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@rm -f $(BINARY_NAME)
	@go clean
	@echo "Clean complete"

# Run the binary
run: build
	@$(BUILD_DIR)/$(BINARY_NAME)

# Check code formatting
fmt:
	@echo "Checking code formatting..."
	@go fmt ./...

# Download dependencies
deps:
	@echo "Downloading dependencies..."
	@go mod download
	@go mod tidy
