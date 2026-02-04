// Package chunking provides text chunking utilities for embedding generation
package chunking

import (
	"strings"
	"unicode/utf8"
)

// Chunk represents a text chunk with its position information
type Chunk struct {
	Text      string
	StartPos  int
	EndPos    int
	ChunkNum  int
	TotalSize int
}

// ChunkText splits text into overlapping chunks based on character count
// Returns a slice of chunks. If chunkSize is 0 or text is smaller than chunkSize,
// returns a single chunk with the full text.
func ChunkText(text string, chunkSize, overlap int) []Chunk {
	// Validate inputs
	if chunkSize <= 0 {
		return []Chunk{{
			Text:      text,
			StartPos:  0,
			EndPos:    len(text),
			ChunkNum:  0,
			TotalSize: len(text),
		}}
	}

	if overlap < 0 {
		overlap = 0
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 2 // Cap overlap at 50% of chunk size
	}

	textLen := utf8.RuneCountInString(text)
	if textLen <= chunkSize {
		// Text is smaller than chunk size, return as single chunk
		return []Chunk{{
			Text:      text,
			StartPos:  0,
			EndPos:    len(text),
			ChunkNum:  0,
			TotalSize: textLen,
		}}
	}

	// Calculate step size (how much to advance for each chunk)
	step := chunkSize - overlap
	if step <= 0 {
		step = chunkSize / 2
	}

	chunks := make([]Chunk, 0)
	runes := []rune(text)
	chunkNum := 0

	for start := 0; start < textLen; start += step {
		end := start + chunkSize
		if end > textLen {
			end = textLen
		}

		chunkText := string(runes[start:end])

		// Skip empty chunks
		if strings.TrimSpace(chunkText) == "" {
			continue
		}

		chunks = append(chunks, Chunk{
			Text:      chunkText,
			StartPos:  start,
			EndPos:    end,
			ChunkNum:  chunkNum,
			TotalSize: textLen,
		})
		chunkNum++

		// If we've reached the end, stop
		if end >= textLen {
			break
		}
	}

	// If no chunks were created (e.g., all whitespace), return full text as single chunk
	if len(chunks) == 0 {
		return []Chunk{{
			Text:      text,
			StartPos:  0,
			EndPos:    len(text),
			ChunkNum:  0,
			TotalSize: textLen,
		}}
	}

	return chunks
}

// ChunkCount returns the number of chunks that would be created for the given text
func ChunkCount(text string, chunkSize, overlap int) int {
	if chunkSize <= 0 {
		return 1
	}

	textLen := utf8.RuneCountInString(text)
	if textLen <= chunkSize {
		return 1
	}

	if overlap < 0 {
		overlap = 0
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 2
	}

	step := chunkSize - overlap
	if step <= 0 {
		step = chunkSize / 2
	}

	count := 0
	for start := 0; start < textLen; start += step {
		count++
		end := start + chunkSize
		if end >= textLen {
			break
		}
	}

	return count
}

// ShouldChunk returns true if the text should be chunked based on the chunk size
func ShouldChunk(text string, chunkSize int) bool {
	if chunkSize <= 0 {
		return false
	}
	return utf8.RuneCountInString(text) > chunkSize
}
