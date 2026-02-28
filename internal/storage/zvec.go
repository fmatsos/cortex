package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

// ZvecStorage implements Storage using a Python zvec sidecar over HTTP.
type ZvecStorage struct {
	process *ZvecProcess
	baseURL string
	client  *http.Client
}

// NewZvecStorage creates and starts a ZvecStorage backed by a zvec sidecar.
// dataDir is the directory where zvec data is persisted.
// port is the port for the sidecar; 0 means auto-select a free port.
// dimension is the embedding vector dimension (e.g. 768 for nomic-embed-text).
func NewZvecStorage(dataDir string, port, dimension int) (*ZvecStorage, error) {
	proc := NewZvecProcess(dataDir, port, dimension)
	if err := proc.Start(); err != nil {
		return nil, fmt.Errorf("failed to start zvec sidecar: %w", err)
	}
	return &ZvecStorage{
		process: proc,
		baseURL: proc.BaseURL(),
		client:  &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// zvecMemoryPayload is the request body for save/update operations.
type zvecMemoryPayload struct {
	ID        string         `json:"id"`
	Level     string         `json:"level"`
	Embedding []float64      `json:"embedding"`
	SessionID string         `json:"session_id,omitempty"`
	Data      map[string]any `json:"data"`
}

// memoryToPayload converts a Memory to a zvecMemoryPayload.
// The embedding is stored both as a top-level field (for the zvec vector index)
// and inside Data["embedding"] (for round-trip fidelity on Get/Update).
//
// json.Marshal is used to populate Data because Memory has many fields and
// the JSON tags already define the canonical serialization format. The embedding
// is added manually afterwards because Memory.Embedding carries `json:"-"`.
func memoryToPayload(m *memory.Memory) zvecMemoryPayload {
	// json.Marshal excludes Embedding (json:"-"), so build the map manually.
	b, _ := json.Marshal(m)
	var data map[string]any
	_ = json.Unmarshal(b, &data)
	if data == nil {
		data = make(map[string]any)
	}
	// Persist the embedding explicitly so it survives a round-trip through JSON.
	if len(m.Embedding) > 0 {
		data["embedding"] = m.Embedding
	}
	return zvecMemoryPayload{
		ID:        m.ID,
		Level:     string(m.Level),
		Embedding: m.Embedding,
		SessionID: m.Context.SessionID,
		Data:      data,
	}
}

// mapToMemory converts a raw JSON map (as returned by the sidecar) back to a Memory.
// The embedding is extracted from the "embedding" key and set on Memory.Embedding.
func mapToMemory(data map[string]any) (*memory.Memory, error) {
	// Extract the embedding before standard JSON unmarshal (Memory.Embedding has json:"-").
	var embedding []float64
	if raw, ok := data["embedding"]; ok {
		switch v := raw.(type) {
		case []any:
			embedding = make([]float64, len(v))
			for i, elem := range v {
				if f, ok := elem.(float64); ok {
					embedding[i] = f
				}
			}
		case []float64:
			embedding = v
		}
	}

	b, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var m memory.Memory
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m.Embedding = embedding
	return &m, nil
}

// Save saves a memory to the zvec sidecar.
func (z *ZvecStorage) Save(ctx context.Context, m *memory.Memory) error {
	return z.postJSON(ctx, z.baseURL+"/memories", memoryToPayload(m), nil)
}

// Get retrieves a memory by ID.
func (z *ZvecStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	var data map[string]any
	if err := z.getJSON(ctx, z.baseURL+"/memories/"+url.PathEscape(id), &data); err != nil {
		return nil, err
	}
	return mapToMemory(data)
}

// List returns memories matching the given options.
func (z *ZvecStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	params := url.Values{}
	if len(opts.FilterLevels) > 0 {
		parts := make([]string, len(opts.FilterLevels))
		for i, l := range opts.FilterLevels {
			parts[i] = string(l)
		}
		params.Set("levels", strings.Join(parts, ","))
	}
	if opts.IncludeObsolete {
		params.Set("include_obsolete", "true")
	}
	if opts.Limit > 0 {
		params.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Reverse {
		params.Set("reverse", "true")
	}

	endpoint := z.baseURL + "/memories"
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	var resp struct {
		Memories []map[string]any `json:"memories"`
	}
	if err := z.getJSON(ctx, endpoint, &resp); err != nil {
		return nil, err
	}

	result := make([]*memory.Memory, 0, len(resp.Memories))
	for _, d := range resp.Memories {
		m, err := mapToMemory(d)
		if err != nil {
			return nil, fmt.Errorf("failed to decode memory: %w", err)
		}
		result = append(result, m)
	}
	return result, nil
}

// Delete permanently deletes a memory by ID.
func (z *ZvecStorage) Delete(ctx context.Context, id string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		z.baseURL+"/memories/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	resp, err := z.client.Do(req)
	if err != nil {
		return fmt.Errorf("zvec delete failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusNoContent:
		return nil
	case http.StatusNotFound:
		return fmt.Errorf("memory not found: %s", id)
	default:
		return fmt.Errorf("zvec delete returned status %d", resp.StatusCode)
	}
}

// Update updates an existing memory.
func (z *ZvecStorage) Update(ctx context.Context, m *memory.Memory) error {
	return z.putJSON(ctx, z.baseURL+"/memories/"+url.PathEscape(m.ID), memoryToPayload(m), nil)
}

// SearchAllLayers performs semantic similarity search across all memory layers.
func (z *ZvecStorage) SearchAllLayers(ctx context.Context, vector []float64, opts memory.SearchOptions) ([]*memory.SearchResult, error) {
	type searchPayload struct {
		Vector          []float64 `json:"vector"`
		TopK            int       `json:"top_k"`
		MinScore        float64   `json:"min_score"`
		FilterLevels    []string  `json:"filter_levels,omitempty"`
		IncludeObsolete bool      `json:"include_obsolete"`
		SessionID       string    `json:"session_id,omitempty"`
	}

	levels := make([]string, len(opts.FilterLevels))
	for i, l := range opts.FilterLevels {
		levels[i] = string(l)
	}
	payload := searchPayload{
		Vector:          vector,
		TopK:            opts.TopK,
		MinScore:        opts.MinScore,
		FilterLevels:    levels,
		IncludeObsolete: opts.IncludeObsolete,
		SessionID:       opts.SessionID,
	}

	var resp struct {
		Results []struct {
			Memory map[string]any `json:"memory"`
			Score  float64        `json:"score"`
		} `json:"results"`
	}
	if err := z.postJSON(ctx, z.baseURL+"/search", payload, &resp); err != nil {
		return nil, err
	}

	results := make([]*memory.SearchResult, 0, len(resp.Results))
	for _, r := range resp.Results {
		m, err := mapToMemory(r.Memory)
		if err != nil {
			return nil, fmt.Errorf("failed to decode search result: %w", err)
		}
		results = append(results, &memory.SearchResult{Memory: m, Score: r.Score})
	}
	return results, nil
}

// TransferWorkingToEpisodic promotes all working memories for the given session
// to episodic level in persistent storage.
func (z *ZvecStorage) TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error) {
	var resp struct {
		Transferred int `json:"transferred"`
	}
	endpoint := z.baseURL + "/transfer/" + url.PathEscape(sessionID)
	if err := z.postJSON(ctx, endpoint, nil, &resp); err != nil {
		return 0, err
	}
	return resp.Transferred, nil
}

// Close stops the zvec sidecar process.
func (z *ZvecStorage) Close() error {
	return z.process.Stop()
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func (z *ZvecStorage) getJSON(ctx context.Context, endpoint string, result any) error {
	return z.doJSON(ctx, http.MethodGet, endpoint, nil, result)
}

func (z *ZvecStorage) postJSON(ctx context.Context, endpoint string, body, result any) error {
	return z.doJSON(ctx, http.MethodPost, endpoint, body, result)
}

func (z *ZvecStorage) putJSON(ctx context.Context, endpoint string, body, result any) error {
	return z.doJSON(ctx, http.MethodPut, endpoint, body, result)
}

func (z *ZvecStorage) doJSON(ctx context.Context, method, endpoint string, body, result any) error {
	var req *http.Request
	var err error

	if body != nil {
		encoded, merr := json.Marshal(body)
		if merr != nil {
			return fmt.Errorf("failed to marshal request body: %w", merr)
		}
		req, err = http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(encoded))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, err = http.NewRequestWithContext(ctx, method, endpoint, nil)
		if err != nil {
			return err
		}
	}

	resp, err := z.client.Do(req)
	if err != nil {
		return fmt.Errorf("zvec request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		var errBody struct {
			Detail string `json:"detail"`
		}
		if json.NewDecoder(resp.Body).Decode(&errBody) == nil && errBody.Detail != "" {
			return fmt.Errorf("%s", errBody.Detail)
		}
		return fmt.Errorf("not found")
	}

	if resp.StatusCode >= 400 {
		var errBody struct {
			Detail string `json:"detail"`
		}
		if json.NewDecoder(resp.Body).Decode(&errBody) == nil && errBody.Detail != "" {
			return fmt.Errorf("zvec sidecar error: %s", errBody.Detail)
		}
		return fmt.Errorf("zvec sidecar returned status %d", resp.StatusCode)
	}

	if result != nil && resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}
	}
	return nil
}
