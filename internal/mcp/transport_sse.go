package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	charmlog "github.com/charmbracelet/log"
	"github.com/google/uuid"
)

// SSETransport implements Transport using Server-Sent Events over HTTP
type SSETransport struct {
	server     *http.Server
	addr       string
	requests   chan *Request
	responses  map[string]chan *Response // sessionID -> response channel
	clients    map[string]http.ResponseWriter
	sessionMap map[interface{}]string // request ID -> session ID mapping
	mu         sync.RWMutex
	logger     *charmlog.Logger
	closed     bool
	closedChan chan struct{}
}

// SSETransportConfig holds configuration for SSE transport
type SSETransportConfig struct {
	Address string           // Address to listen on (e.g., ":8080" or "127.0.0.1:8080")
	Logger  *charmlog.Logger // nil = default charm logger to stderr
}

// NewSSETransport creates a new SSE transport
func NewSSETransport(config SSETransportConfig) *SSETransport {
	if config.Address == "" {
		config.Address = ":8080"
	}

	logger := config.Logger
	if logger == nil {
		logger = charmlog.NewWithOptions(os.Stderr, charmlog.Options{Prefix: "mcp-sse"})
	}

	return &SSETransport{
		addr:       config.Address,
		requests:   make(chan *Request, 100),
		responses:  make(map[string]chan *Response),
		clients:    make(map[string]http.ResponseWriter),
		sessionMap: make(map[interface{}]string),
		logger:     logger,
		closedChan: make(chan struct{}),
	}
}

// Start starts the HTTP server for SSE transport
func (t *SSETransport) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/sse", t.handleSSE)
	mux.HandleFunc("/message", t.handleMessage)
	mux.HandleFunc("/health", t.handleHealth)

	t.server = &http.Server{
		Addr:              t.addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	t.logger.Info("starting SSE transport", "addr", t.addr)
	t.logger.Info("SSE endpoint", "url", "http://"+t.addr+"/sse")
	t.logger.Info("message endpoint", "url", "http://"+t.addr+"/message")

	go func() {
		if err := t.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.logger.Error("HTTP server error", "err", err)
		}
	}()

	return nil
}

// handleSSE handles SSE connection from clients
func (t *SSETransport) handleSSE(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Generate session ID
	sessionID := uuid.New().String()

	// Create response channel for this session
	respChan := make(chan *Response, 100)

	t.mu.Lock()
	t.responses[sessionID] = respChan
	t.clients[sessionID] = w
	t.mu.Unlock()

	t.logger.Info("client connected", "session", sessionID)

	// Send endpoint event with message URL
	messageEndpoint := fmt.Sprintf("http://%s/message?session_id=%s", r.Host, sessionID)
	_, _ = fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", messageEndpoint)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	// Keep connection alive and send responses
	defer func() {
		t.mu.Lock()
		delete(t.responses, sessionID)
		delete(t.clients, sessionID)
		t.mu.Unlock()
		close(respChan)
		t.logger.Info("client disconnected", "session", sessionID)
	}()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-t.closedChan:
			return
		case resp, ok := <-respChan:
			if !ok {
				return
			}

			data, err := json.Marshal(resp)
			if err != nil {
				t.logger.Error("failed to marshal response", "err", err)
				continue
			}

			_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}
}

// handleMessage handles incoming messages from clients
func (t *SSETransport) handleMessage(w http.ResponseWriter, r *http.Request) {
	// Allow CORS preflight
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}

	t.mu.RLock()
	_, exists := t.responses[sessionID]
	t.mu.RUnlock()

	if !exists {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}
	defer func() { _ = r.Body.Close() }()

	var req Request
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Store session ID in request for routing response
	// We use a wrapper to associate requests with sessions
	wrappedReq := &Request{
		JSONRPC: req.JSONRPC,
		ID:      req.ID,
		Method:  req.Method,
		Params:  req.Params,
	}

	// Store session mapping temporarily (no-op for now)

	select {
	case t.requests <- wrappedReq:
		// Store the session ID for this request
		t.mu.Lock()
		t.sessionMap[req.ID] = sessionID
		t.mu.Unlock()

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "accepted"})
	default:
		http.Error(w, "Server busy", http.StatusServiceUnavailable)
	}
}

// handleHealth handles health check requests
func (t *SSETransport) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Receive reads a request from the message queue
func (t *SSETransport) Receive(ctx context.Context) (*Request, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-t.closedChan:
		return nil, io.EOF
	case req, ok := <-t.requests:
		if !ok {
			return nil, io.EOF
		}
		return req, nil
	}
}

// Send sends a response to the appropriate client
func (t *SSETransport) Send(ctx context.Context, resp *Response) error {
	// Find the session for this response
	t.mu.RLock()
	sessionID, ok := t.sessionMap[resp.ID]
	t.mu.RUnlock()

	if !ok {
		// Broadcast to all clients if no specific session
		t.mu.RLock()
		defer t.mu.RUnlock()
		for _, respChan := range t.responses {
			select {
			case respChan <- resp:
			default:
				// Channel full, skip
			}
		}
		return nil
	}

	// Clean up the session mapping
	t.mu.Lock()
	delete(t.sessionMap, resp.ID)
	t.mu.Unlock()

	t.mu.RLock()
	respChan, exists := t.responses[sessionID]
	t.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case respChan <- resp:
		return nil
	default:
		return fmt.Errorf("response channel full")
	}
}

// Close shuts down the SSE transport
func (t *SSETransport) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	close(t.closedChan)
	t.mu.Unlock()

	if t.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return t.server.Shutdown(ctx)
	}
	return nil
}

// Address returns the address the server is listening on
func (t *SSETransport) Address() string {
	return t.addr
}
