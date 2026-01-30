package embeddings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"
)

// OllamaEmbedder generates embeddings using Ollama API
type OllamaEmbedder struct {
	endpoint  string
	model     string
	client    *http.Client
	dimension int
}

// OllamaRequest is the request format for Ollama API
type OllamaRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

// OllamaResponse is the response format from Ollama API
type OllamaResponse struct {
	Embedding []float64 `json:"embedding"`
}

// NewOllamaEmbedder creates a new Ollama embedder
func NewOllamaEmbedder(endpoint, model string, timeout time.Duration) (*OllamaEmbedder, error) {
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}

	if timeout == 0 {
		timeout = 30 * time.Second
	}

	client := &http.Client{
		Timeout: timeout,
	}

	embedder := &OllamaEmbedder{
		endpoint: endpoint,
		model:    model,
		client:   client,
	}

	// Test connection and get dimension
	testEmbedding, err := embedder.embed(context.Background(), "test")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ollama: %w", err)
	}

	embedder.dimension = len(testEmbedding)
	return embedder, nil
}

// Embed generates an embedding for text
func (o *OllamaEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
	return o.embed(ctx, text)
}

// EmbedBatch generates embeddings for multiple texts
func (o *OllamaEmbedder) EmbedBatch(ctx context.Context, texts []string) ([][]float64, error) {
	embeddings := make([][]float64, len(texts))
	for i, text := range texts {
		embedding, err := o.embed(ctx, text)
		if err != nil {
			return nil, fmt.Errorf("failed to embed text %d: %w", i, err)
		}
		embeddings[i] = embedding
	}
	return embeddings, nil
}

// Dimension returns the embedding dimension
func (o *OllamaEmbedder) Dimension() int {
	return o.dimension
}

// embed is the internal method that handles embedding
func (o *OllamaEmbedder) embed(ctx context.Context, text string) ([]float64, error) {
	req := OllamaRequest{
		Model:  o.model,
		Prompt: text,
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/api/embeddings", o.endpoint),
		bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := o.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call Ollama API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Ollama API returned status %d: %s", resp.StatusCode, string(body))
	}

	var respBody OllamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&respBody); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Normalize the embedding
	return normalize(respBody.Embedding), nil
}

// normalize normalizes a vector to unit length
func normalize(v []float64) []float64 {
	norm := 0.0
	for _, val := range v {
		norm += val * val
	}
	norm = math.Sqrt(norm)

	if norm == 0 {
		return v
	}

	result := make([]float64, len(v))
	for i, val := range v {
		result[i] = val / norm
	}

	return result
}
