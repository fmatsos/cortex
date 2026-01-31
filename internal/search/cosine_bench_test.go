package search

import (
	"math/rand"
	"testing"
)

// generateRandomVector creates a random normalized vector
func generateRandomVector(dim int) []float64 {
	vec := make([]float64, dim)
	var sum float64
	for i := range vec {
		vec[i] = rand.Float64()
		sum += vec[i] * vec[i]
	}
	// Normalize
	norm := 1.0 / sum
	for i := range vec {
		vec[i] *= norm
	}
	return vec
}

// BenchmarkCosineSimilarity benchmarks cosine similarity calculation
func BenchmarkCosineSimilarity(b *testing.B) {
	dimensions := []int{128, 256, 384, 512, 768, 1536}

	for _, dim := range dimensions {
		vec1 := generateRandomVector(dim)
		vec2 := generateRandomVector(dim)

		b.Run(string(rune('0'+dim/100))+"d", func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				CosineSimilarity(vec1, vec2)
			}
		})
	}
}

// BenchmarkCosineSimilarity384 benchmarks 384-dim vectors (nomic-embed-text)
func BenchmarkCosineSimilarity384(b *testing.B) {
	vec1 := generateRandomVector(384)
	vec2 := generateRandomVector(384)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CosineSimilarity(vec1, vec2)
	}
}

// BenchmarkVectorSearch benchmarks searching through N vectors
func BenchmarkVectorSearch(b *testing.B) {
	sizes := []int{100, 1000, 10000}
	dim := 384

	for _, size := range sizes {
		// Generate vector database
		vectors := make([][]float64, size)
		for i := range vectors {
			vectors[i] = generateRandomVector(dim)
		}
		query := generateRandomVector(dim)

		b.Run(string(rune('0'+size/100))+"vectors", func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				// Simulate top-k search
				for j := 0; j < size; j++ {
					CosineSimilarity(query, vectors[j])
				}
			}
		})
	}
}
