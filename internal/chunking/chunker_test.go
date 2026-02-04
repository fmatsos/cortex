package chunking

import (
	"strings"
	"testing"
)

func TestChunkText_NoChunking(t *testing.T) {
	text := "Short text"
	chunks := ChunkText(text, 100, 10)

	if len(chunks) != 1 {
		t.Errorf("Expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Text != text {
		t.Errorf("Expected chunk text to equal input text")
	}
	if chunks[0].ChunkNum != 0 {
		t.Errorf("Expected chunk num 0, got %d", chunks[0].ChunkNum)
	}
}

func TestChunkText_ZeroChunkSize(t *testing.T) {
	text := "Some text that should not be chunked"
	chunks := ChunkText(text, 0, 10)

	if len(chunks) != 1 {
		t.Errorf("Expected 1 chunk with chunkSize=0, got %d", len(chunks))
	}
	if chunks[0].Text != text {
		t.Errorf("Expected full text in single chunk")
	}
}

func TestChunkText_WithOverlap(t *testing.T) {
	// Create a text longer than chunk size
	text := strings.Repeat("a", 100)
	chunkSize := 30
	overlap := 5

	chunks := ChunkText(text, chunkSize, overlap)

	if len(chunks) == 1 {
		t.Errorf("Expected multiple chunks, got 1")
	}

	// Check that chunks overlap correctly
	for i := 1; i < len(chunks); i++ {
		prevChunk := chunks[i-1]
		currChunk := chunks[i]

		// The current chunk should start before the previous chunk ends
		if currChunk.StartPos >= prevChunk.EndPos {
			t.Errorf("Chunk %d does not overlap with chunk %d", i, i-1)
		}

		// Overlap should be approximately equal to the configured overlap
		actualOverlap := prevChunk.EndPos - currChunk.StartPos
		if actualOverlap < overlap-1 || actualOverlap > overlap+1 {
			t.Logf("Warning: overlap between chunk %d and %d is %d, expected ~%d", i-1, i, actualOverlap, overlap)
		}
	}
}

func TestChunkText_Unicode(t *testing.T) {
	// Test with unicode characters
	text := "Hello 世界! This is a test with émojis 😀 and spëcial çharacters."
	chunkSize := 20
	overlap := 5

	chunks := ChunkText(text, chunkSize, overlap)

	if len(chunks) == 0 {
		t.Errorf("Expected at least one chunk")
	}

	// Verify that all chunks contain valid UTF-8
	for i, chunk := range chunks {
		if !isValidUTF8(chunk.Text) {
			t.Errorf("Chunk %d contains invalid UTF-8", i)
		}
	}
}

func TestChunkText_EmptyString(t *testing.T) {
	chunks := ChunkText("", 100, 10)

	if len(chunks) != 1 {
		t.Errorf("Expected 1 chunk for empty string, got %d", len(chunks))
	}
	if chunks[0].Text != "" {
		t.Errorf("Expected empty chunk text")
	}
}

func TestChunkText_WhitespaceOnly(t *testing.T) {
	text := "     \n\n   \t  "
	chunks := ChunkText(text, 5, 1)

	// Should return a single chunk even if it's whitespace
	if len(chunks) != 1 {
		t.Errorf("Expected 1 chunk for whitespace-only text, got %d", len(chunks))
	}
}

func TestChunkCount(t *testing.T) {
	tests := []struct {
		name      string
		textLen   int
		chunkSize int
		overlap   int
		expected  int
	}{
		{"Short text", 50, 100, 10, 1},
		{"Exact chunk size", 100, 100, 0, 1},
		{"Two chunks no overlap", 150, 100, 0, 2},
		{"Multiple chunks with overlap", 200, 50, 10, 5},
		{"Zero chunk size", 100, 0, 10, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			text := strings.Repeat("a", tt.textLen)
			count := ChunkCount(text, tt.chunkSize, tt.overlap)
			if count != tt.expected {
				t.Errorf("Expected %d chunks, got %d", tt.expected, count)
			}

			// Verify count matches actual chunking
			actualChunks := ChunkText(text, tt.chunkSize, tt.overlap)
			if len(actualChunks) != count {
				t.Errorf("ChunkCount returned %d but ChunkText created %d chunks", count, len(actualChunks))
			}
		})
	}
}

func TestShouldChunk(t *testing.T) {
	tests := []struct {
		name      string
		textLen   int
		chunkSize int
		expected  bool
	}{
		{"Short text", 50, 100, false},
		{"Exact size", 100, 100, false},
		{"Long text", 150, 100, true},
		{"Zero chunk size", 100, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			text := strings.Repeat("a", tt.textLen)
			result := ShouldChunk(text, tt.chunkSize)
			if result != tt.expected {
				t.Errorf("Expected ShouldChunk to return %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestChunkText_ExcessiveOverlap(t *testing.T) {
	text := strings.Repeat("a", 100)
	chunkSize := 30
	overlap := 40 // Overlap larger than chunk size

	chunks := ChunkText(text, chunkSize, overlap)

	// Should cap overlap and still produce chunks
	if len(chunks) == 0 {
		t.Errorf("Expected chunks even with excessive overlap")
	}

	// Verify chunks are created
	if len(chunks) == 1 && len(text) > chunkSize {
		t.Errorf("Expected multiple chunks with excessive overlap adjustment")
	}
}

func TestChunkText_NegativeOverlap(t *testing.T) {
	text := strings.Repeat("a", 100)
	chunkSize := 30
	overlap := -5 // Negative overlap

	chunks := ChunkText(text, chunkSize, overlap)

	// Should treat as zero overlap
	if len(chunks) == 0 {
		t.Errorf("Expected chunks even with negative overlap")
	}
}

// Helper function to check if string is valid UTF-8
func isValidUTF8(s string) bool {
	for _, r := range s {
		if r == '\uFFFD' {
			return false
		}
	}
	return true
}
