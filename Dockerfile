# Cortex Docker Image
# Multi-stage build for minimal image size

FROM golang:1.21-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o cortex ./cmd/cortex

# Final stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/cortex /usr/local/bin/

# Create data directory
RUN mkdir -p /data

# Set environment
ENV CORTEX_STORAGE_PATH=/data

# Default command
ENTRYPOINT ["cortex"]
CMD ["--help"]
