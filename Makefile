.PHONY: build test lint install clean help

# Variables
BINARY_NAME=cortex
MAIN_PATH=./cmd/cortex
BUILD_DIR=./bin
VERSION?=dev
LDFLAGS=-ldflags "-X main.Version=$(VERSION)"

# Default target
help:
	@echo "Cortex AI - CLI tool for persistent AI agent memory"
	@echo ""
	@echo "Available targets:"
	@echo "  build       - Build the cortex binary"
	@echo "  install     - Build and install cortex to GOBIN"
	@echo "  test        - Run all tests"
	@echo "  test-race   - Run tests with race detector"
	@echo "  lint        - Run linter"
	@echo "  clean       - Remove build artifacts"
	@echo "  help        - Show this help message"

# Build the CLI binary
build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	@go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) $(MAIN_PATH)
	@echo "Build complete: $(BUILD_DIR)/$(BINARY_NAME)"

# Install CLI to GOBIN
install:
	@echo "Installing $(BINARY_NAME)..."
	@go install $(LDFLAGS) $(MAIN_PATH)
	@echo "Installation complete"

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
