package embeddings

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewOllamaEmbedder(t *testing.T) {
	// Create a mock Ollama server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/embeddings" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = 0.1
		}

		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	embedder, err := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 8000, 200, "average")
	if err != nil {
		t.Fatalf("NewOllamaEmbedder() error = %v", err)
	}

	// Dimension is lazy — 0 until first Embed call triggers ensureDimension
	if embedder.Dimension() != 0 {
		t.Errorf("Dimension() = %v, want 0 before first embed", embedder.Dimension())
	}

	// Trigger lazy init via Embed
	_, embErr := embedder.Embed(context.Background(), "hello")
	if embErr != nil {
		t.Fatalf("Embed() error = %v", embErr)
	}

	if embedder.Dimension() != 384 {
		t.Errorf("Dimension() = %v, want 384 after first embed", embedder.Dimension())
	}
}

func TestNewOllamaEmbedder_ConnectionFailed(t *testing.T) {
	// Constructor no longer connects — it always succeeds (lazy init)
	embedder, err := NewOllamaEmbedder("http://invalid-host:99999", "nomic-embed-text", 1*time.Second, 8000, 200, "average")
	if err != nil {
		t.Fatalf("NewOllamaEmbedder() should not return error (lazy): %v", err)
	}
	if embedder == nil {
		t.Fatal("NewOllamaEmbedder() should return non-nil embedder (lazy)")
	}

	// Connection failure surfaces on first Embed call
	_, embErr := embedder.Embed(context.Background(), "test")
	if embErr == nil {
		t.Error("Embed() should fail for unreachable host")
	}
}

func TestOllamaEmbedder_Embed(t *testing.T) {
	// Create a mock Ollama server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req OllamaRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		// Return embedding based on input
		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = 0.1
		}

		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 8000, 200, "average")

	embedding, err := embedder.Embed(context.Background(), "test text")
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}

	if len(embedding) != 384 {
		t.Errorf("Embedding length = %v, want 384", len(embedding))
	}

	// Check that embedding is normalized
	norm := 0.0
	for _, val := range embedding {
		norm += val * val
	}
	norm = math.Sqrt(norm)

	if math.Abs(norm-1.0) > 0.001 {
		t.Errorf("Embedding norm = %v, want ~1.0", norm)
	}
}

func TestOllamaEmbedder_EmbedBatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = 0.1
		}
		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 8000, 200, "average")

	texts := []string{"text1", "text2", "text3"}
	embeddings, err := embedder.EmbedBatch(context.Background(), texts)
	if err != nil {
		t.Fatalf("EmbedBatch() error = %v", err)
	}

	if len(embeddings) != 3 {
		t.Errorf("EmbedBatch() returned %d embeddings, want 3", len(embeddings))
	}

	for i, embedding := range embeddings {
		if len(embedding) != 384 {
			t.Errorf("Embedding %d length = %v, want 384", i, len(embedding))
		}
	}
}

func TestOllamaEmbedder_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	// Create embedder with custom endpoint that returns error
	client := &http.Client{Timeout: 5 * time.Second}
	embedder := &OllamaEmbedder{
		endpoint:      server.URL,
		model:         "nomic-embed-text",
		client:        client,
		dimension:     384,
		chunkSize:     8000,
		chunkOverlap:  200,
		chunkStrategy: "average",
	}

	_, err := embedder.Embed(context.Background(), "test")
	if err == nil {
		t.Error("Embed() should return error when API fails")
	}
}

func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		v    []float64
		want float64 // Expected norm
	}{
		{
			name: "unit vector",
			v:    []float64{1, 0, 0},
			want: 1.0,
		},
		{
			name: "3-4-5 triangle",
			v:    []float64{3, 4},
			want: 1.0,
		},
		{
			name: "zero vector",
			v:    []float64{0, 0, 0},
			want: 0.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			normalized := normalize(tt.v)

			// Calculate norm
			norm := 0.0
			for _, val := range normalized {
				norm += val * val
			}
			norm = math.Sqrt(norm)

			if math.Abs(norm-tt.want) > 0.0001 {
				t.Errorf("normalize() norm = %v, want %v", norm, tt.want)
			}
		})
	}
}

func TestOllamaEmbedder_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		embedding := make([]float64, 384)
		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	embedder := &OllamaEmbedder{
		endpoint:      server.URL,
		model:         "nomic-embed-text",
		client:        client,
		dimension:     384,
		chunkSize:     8000,
		chunkOverlap:  200,
		chunkStrategy: "average",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := embedder.Embed(ctx, "test")
	if err == nil {
		t.Error("Embed() should return error when context is cancelled")
	}
}

func TestOllamaEmbedder_ChunkingSmallText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = 0.1
		}
		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Create embedder with small chunk size to force chunking
	embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 50, 10, "average")

	// Small text should not be chunked
	embedding, err := embedder.Embed(context.Background(), "Short text")
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}

	if len(embedding) != 384 {
		t.Errorf("Embedding length = %v, want 384", len(embedding))
	}

	// Check that embedding is normalized
	norm := 0.0
	for _, val := range embedding {
		norm += val * val
	}
	norm = math.Sqrt(norm)

	if math.Abs(norm-1.0) > 0.001 {
		t.Errorf("Embedding norm = %v, want ~1.0", norm)
	}
}

func TestOllamaEmbedder_ChunkingLongText(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = float64(callCount) * 0.1
		}
		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Create embedder with small chunk size to force chunking
	embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 50, 10, "average")

	// Long text should be chunked (more than 50 characters)
	longText := "This is a very long text that should definitely be chunked into multiple pieces because it exceeds the configured chunk size by quite a bit."
	embedding, err := embedder.Embed(context.Background(), longText)
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}

	if len(embedding) != 384 {
		t.Errorf("Embedding length = %v, want 384", len(embedding))
	}

	// Verify that multiple API calls were made (one per chunk)
	if callCount <= 1 {
		t.Errorf("Expected multiple API calls for chunked text, got %d", callCount)
	}

	// Check that embedding is normalized
	norm := 0.0
	for _, val := range embedding {
		norm += val * val
	}
	norm = math.Sqrt(norm)

	if math.Abs(norm-1.0) > 0.001 {
		t.Errorf("Embedding norm = %v, want ~1.0", norm)
	}
}

func TestOllamaEmbedder_ChunkingStrategies(t *testing.T) {
	strategies := []string{"average", "first", "max_pool"}

	for _, strategy := range strategies {
		t.Run(strategy, func(t *testing.T) {
			callCount := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				callCount++
				embedding := make([]float64, 384)
				for i := 0; i < 384; i++ {
					embedding[i] = float64(callCount) * 0.1
				}
				resp := OllamaResponse{Embedding: embedding}
				_ = json.NewEncoder(w).Encode(resp)
			}))
			defer server.Close()

			embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 50, 10, strategy)

			longText := "This is a very long text that should definitely be chunked into multiple pieces because it exceeds the configured chunk size."
			embedding, err := embedder.Embed(context.Background(), longText)
			if err != nil {
				t.Fatalf("Embed() error = %v", err)
			}

			if len(embedding) != 384 {
				t.Errorf("Embedding length = %v, want 384", len(embedding))
			}

			// Check that embedding is normalized
			norm := 0.0
			for _, val := range embedding {
				norm += val * val
			}
			norm = math.Sqrt(norm)

			if math.Abs(norm-1.0) > 0.001 {
				t.Errorf("Embedding norm = %v, want ~1.0 for strategy %s", norm, strategy)
			}
		})
	}
}

func TestOllamaEmbedder_ChunkingDisabled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		embedding := make([]float64, 384)
		for i := 0; i < 384; i++ {
			embedding[i] = 0.1
		}
		resp := OllamaResponse{Embedding: embedding}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Create embedder with chunk size 0 to disable chunking
	embedder, _ := NewOllamaEmbedder(server.URL, "nomic-embed-text", 5*time.Second, 0, 0, "average")

	// Even long text should not be chunked
	longText := "This is a very long text that should definitely be chunked into multiple pieces because it exceeds the configured chunk size by quite a bit."
	embedding, err := embedder.Embed(context.Background(), longText)
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}

	if len(embedding) != 384 {
		t.Errorf("Embedding length = %v, want 384", len(embedding))
	}
}
