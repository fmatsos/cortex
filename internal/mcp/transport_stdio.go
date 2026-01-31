package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
)

// StdioTransport implements Transport using stdin/stdout
type StdioTransport struct {
	reader *bufio.Reader
	writer io.Writer
	mu     sync.Mutex
	closed bool
}

// NewStdioTransport creates a new stdio transport
func NewStdioTransport(reader io.Reader, writer io.Writer) *StdioTransport {
	return &StdioTransport{
		reader: bufio.NewReader(reader),
		writer: writer,
	}
}

// Receive reads and parses a JSON-RPC request from stdin
func (t *StdioTransport) Receive(ctx context.Context) (*Request, error) {
	// Create a channel for the result
	type result struct {
		req *Request
		err error
	}
	ch := make(chan result, 1)

	go func() {
		for {
			line, err := t.reader.ReadString('\n')
			if err != nil {
				ch <- result{nil, err}
				return
			}

			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			var req Request
			if err := json.Unmarshal([]byte(line), &req); err != nil {
				ch <- result{nil, fmt.Errorf("parse error: %w", err)}
				return
			}

			ch <- result{&req, nil}
			return
		}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-ch:
		return r.req, r.err
	}
}

// Send writes a JSON-RPC response to stdout
func (t *StdioTransport) Send(ctx context.Context, resp *Response) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return fmt.Errorf("transport closed")
	}

	data, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	_, err = fmt.Fprintln(t.writer, string(data))
	return err
}

// Close closes the transport
func (t *StdioTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	return nil
}
