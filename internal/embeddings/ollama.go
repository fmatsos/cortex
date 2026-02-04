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

	"github.com/cortex-ai/cortex-ai/internal/chunking"
)

// OllamaEmbedder generates embeddings using Ollama API
type OllamaEmbedder struct {
	endpoint      string
	model         string
	client        *http.Client
	dimension     int
	chunkSize     int
	chunkOverlap  int
	chunkStrategy string
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
func NewOllamaEmbedder(endpoint, model string, timeout time.Duration, chunkSize, chunkOverlap int, chunkStrategy string) (*OllamaEmbedder, error) {
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}

	if timeout == 0 {
		timeout = 30 * time.Second
	}

	if chunkStrategy == "" {
		chunkStrategy = "average"
	}

	client := &http.Client{
		Timeout: timeout,
	}

	embedder := &OllamaEmbedder{
		endpoint:      endpoint,
		model:         model,
		client:        client,
		chunkSize:     chunkSize,
		chunkOverlap:  chunkOverlap,
		chunkStrategy: chunkStrategy,
	}

	// Test connection and get dimension
	testEmbedding, err := embedder.embedSingle(context.Background(), "test")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ollama: %w", err)
	}

	embedder.dimension = len(testEmbedding)
	return embedder, nil
}

// Embed generates an embedding for text with automatic chunking if needed
func (o *OllamaEmbedder) Embed(ctx context.Context, text string) ([]float64, error) {
	// Check if chunking is needed
	if !chunking.ShouldChunk(text, o.chunkSize) {
		// Text is small enough, embed directly
		return o.embedSingle(ctx, text)
	}

	// Chunk the text
	chunks := chunking.ChunkText(text, o.chunkSize, o.chunkOverlap)

	// Generate embeddings for each chunk
	embeddings := make([][]float64, len(chunks))
	for i, chunk := range chunks {
		embedding, err := o.embedSingle(ctx, chunk.Text)
		if err != nil {
			return nil, fmt.Errorf("failed to embed chunk %d: %w", i, err)
		}
		embeddings[i] = embedding
	}

	// Combine embeddings based on strategy
	return o.combineEmbeddings(embeddings)
}

// EmbedBatch generates embeddings for multiple texts
func (o *OllamaEmbedder) EmbedBatch(ctx context.Context, texts []string) ([][]float64, error) {
	embeddings := make([][]float64, len(texts))
	for i, text := range texts {
		embedding, err := o.Embed(ctx, text)
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

// embedSingle is the internal method that handles embedding for a single text chunk
func (o *OllamaEmbedder) embedSingle(ctx context.Context, text string) ([]float64, error) {
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
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama API returned status %d: %s", resp.StatusCode, string(body))
	}

	var respBody OllamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&respBody); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Normalize the embedding
	return normalize(respBody.Embedding), nil
}

// combineEmbeddings combines multiple embeddings based on the configured strategy
func (o *OllamaEmbedder) combineEmbeddings(embeddings [][]float64) ([]float64, error) {
	if len(embeddings) == 0 {
		return nil, fmt.Errorf("no embeddings to combine")
	}

	if len(embeddings) == 1 {
		return embeddings[0], nil
	}

	dim := len(embeddings[0])

	switch o.chunkStrategy {
	case "first":
		// Use only the first chunk's embedding
		return embeddings[0], nil

	case "max_pool":
		// Take the maximum value for each dimension across all chunks
		result := make([]float64, dim)
		for d := 0; d < dim; d++ {
			maxVal := embeddings[0][d]
			for i := 1; i < len(embeddings); i++ {
				if embeddings[i][d] > maxVal {
					maxVal = embeddings[i][d]
				}
			}
			result[d] = maxVal
		}
		return normalize(result), nil

	case "average":
		fallthrough
	default:
		// Average all embeddings (default strategy)
		result := make([]float64, dim)
		for _, embedding := range embeddings {
			for d := 0; d < dim; d++ {
				result[d] += embedding[d]
			}
		}
		// Divide by number of embeddings to get average
		for d := 0; d < dim; d++ {
			result[d] /= float64(len(embeddings))
		}
		return normalize(result), nil
	}
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
