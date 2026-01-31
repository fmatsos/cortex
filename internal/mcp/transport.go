// Package mcp implements the Model Context Protocol for Cortex AI
package mcp

import (
	"context"
)

// Transport defines the interface for MCP message transport
type Transport interface {
	// Receive blocks until a message is received or context is cancelled.
	// Returns io.EOF when the transport is closed by the client.
	Receive(ctx context.Context) (*Request, error)

	// Send sends a response to the client.
	Send(ctx context.Context, resp *Response) error

	// Close closes the transport and releases resources.
	Close() error
}

// TransportType represents the type of transport
type TransportType string

const (
	// TransportStdio uses stdin/stdout for communication
	TransportStdio TransportType = "stdio"

	// TransportSSE uses Server-Sent Events over HTTP
	TransportSSE TransportType = "sse"
)

// ValidTransports returns the list of valid transport types
func ValidTransports() []TransportType {
	return []TransportType{TransportStdio, TransportSSE}
}

// IsValidTransport checks if the given transport type is valid
func IsValidTransport(t TransportType) bool {
	for _, valid := range ValidTransports() {
		if t == valid {
			return true
		}
	}
	return false
}
