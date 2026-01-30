package search

import (
	"math"
	"testing"
)

func TestCosineSimilarity(t *testing.T) {
	tests := []struct {
		name string
		a    []float64
		b    []float64
		want float64
	}{
		{
			name: "identical vectors",
			a:    []float64{1, 0, 0},
			b:    []float64{1, 0, 0},
			want: 1.0,
		},
		{
			name: "orthogonal vectors",
			a:    []float64{1, 0, 0},
			b:    []float64{0, 1, 0},
			want: 0.0,
		},
		{
			name: "opposite vectors",
			a:    []float64{1, 0, 0},
			b:    []float64{-1, 0, 0},
			want: -1.0,
		},
		{
			name: "normalized vectors",
			a:    []float64{0.5, 0.5, 0.5, 0.5},
			b:    []float64{0.5, 0.5, 0.5, 0.5},
			want: 1.0,
		},
		{
			name: "different magnitudes",
			a:    []float64{1, 1},
			b:    []float64{2, 2},
			want: 1.0,
		},
		{
			name: "zero vector",
			a:    []float64{0, 0, 0},
			b:    []float64{1, 0, 0},
			want: 0.0,
		},
		{
			name: "empty vectors",
			a:    []float64{},
			b:    []float64{},
			want: 0.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CosineSimilarity(tt.a, tt.b)
			if math.Abs(got-tt.want) > 0.0001 {
				t.Errorf("CosineSimilarity() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCosineSimilarity_MismatchedLengths(t *testing.T) {
	got := CosineSimilarity([]float64{1, 0, 0}, []float64{1, 0})
	if got != 0 {
		t.Errorf("CosineSimilarity() with mismatched lengths = %v, want 0", got)
	}
}
