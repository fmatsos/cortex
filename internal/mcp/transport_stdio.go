package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
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

			line = strings.TrimRight(line, "\r\n")
			if strings.TrimSpace(line) == "" {
				continue
			}

			if strings.HasPrefix(strings.ToLower(line), "content-length:") {
				length, err := parseContentLength(line)
				if err != nil {
					ch <- result{nil, fmt.Errorf("parse error: %w", err)}
					return
				}

				for {
					headerLine, err := t.reader.ReadString('\n')
					if err != nil {
						ch <- result{nil, err}
						return
					}
					if strings.TrimSpace(headerLine) == "" {
						break
					}
				}

				body := make([]byte, length)
				if _, err := io.ReadFull(t.reader, body); err != nil {
					ch <- result{nil, err}
					return
				}

				var req Request
				if err := json.Unmarshal(body, &req); err != nil {
					ch <- result{nil, fmt.Errorf("parse error: %w", err)}
					return
				}

				ch <- result{&req, nil}
				return
			}

			if strings.HasPrefix(strings.TrimSpace(line), "{") {
				var req Request
				if err := json.Unmarshal([]byte(line), &req); err != nil {
					ch <- result{nil, fmt.Errorf("parse error: %w", err)}
					return
				}

				ch <- result{&req, nil}
				return
			}

			ch <- result{nil, fmt.Errorf("parse error: unsupported header: %s", line)}
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

	if _, err := fmt.Fprintf(t.writer, "Content-Length: %d\r\n\r\n", len(data)); err != nil {
		return err
	}
	_, err = t.writer.Write(data)
	return err
}

// Close closes the transport
func (t *StdioTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	return nil
}

func parseContentLength(line string) (int, error) {
	parts := strings.SplitN(line, ":", 2)
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid content-length header")
	}
	value := strings.TrimSpace(parts[1])
	length, err := strconv.Atoi(value)
	if err != nil || length <= 0 {
		return 0, fmt.Errorf("invalid content-length value")
	}
	return length, nil
}
