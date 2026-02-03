package consolidation

import (
	"context"
	"fmt"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
)

// AutopruneService handles automatic memory cleanup and optimization
type AutopruneService struct {
	storage  storage.ConsolidatedStorage
	embedder Embedder
	config   *config.AutopruneConfig
}

// NewAutopruneService creates a new autoprune service
func NewAutopruneService(store storage.ConsolidatedStorage, embedder Embedder, cfg *config.AutopruneConfig) *AutopruneService {
	return &AutopruneService{
		storage:  store,
		embedder: embedder,
		config:   cfg,
	}
}

// AutopruneOptions configures which cleanup operations to perform
type AutopruneOptions struct {
	Duplicates      bool          // remove duplicate memories
	ArchiveEpisodic bool          // archive old episodic memories
	MergeSemantic   bool          // merge similar semantic memories
	DryRun          bool          // simulate without making changes
	OlderThan       time.Duration // age threshold for archiving
}

// AutopruneResult contains the results of an autoprune operation
type AutopruneResult struct {
	DuplicatesRemoved int      `json:"duplicates_removed"`
	EpisodicArchived  int      `json:"episodic_archived"`
	SemanticMerged    int      `json:"semantic_merged"`
	Details           []string `json:"details,omitempty"`
}

// Run executes the autoprune operation based on options
func (s *AutopruneService) Run(ctx context.Context, opts AutopruneOptions) (*AutopruneResult, error) {
	result := &AutopruneResult{
		Details: make([]string, 0),
	}

	// If no specific option is set, run all
	runAll := !opts.Duplicates && !opts.ArchiveEpisodic && !opts.MergeSemantic

	if opts.Duplicates || runAll {
		count, details, err := s.removeDuplicates(ctx, opts.DryRun)
		if err != nil {
			return nil, fmt.Errorf("failed to remove duplicates: %w", err)
		}
		result.DuplicatesRemoved = count
		result.Details = append(result.Details, details...)
	}

	if opts.ArchiveEpisodic || runAll {
		olderThan := opts.OlderThan
		if olderThan == 0 {
			olderThan = time.Duration(s.config.EpisodicRetentionDays) * 24 * time.Hour
		}
		count, details, err := s.archiveEpisodic(ctx, olderThan, opts.DryRun)
		if err != nil {
			return nil, fmt.Errorf("failed to archive episodic: %w", err)
		}
		result.EpisodicArchived = count
		result.Details = append(result.Details, details...)
	}

	if opts.MergeSemantic || runAll {
		count, details, err := s.mergeSemantic(ctx, opts.DryRun)
		if err != nil {
			return nil, fmt.Errorf("failed to merge semantic: %w", err)
		}
		result.SemanticMerged = count
		result.Details = append(result.Details, details...)
	}

	return result, nil
}

// removeDuplicates finds and removes duplicate memories across all levels
func (s *AutopruneService) removeDuplicates(ctx context.Context, dryRun bool) (int, []string, error) {
	var details []string
	removed := 0

	// Check each level
	for _, level := range memory.ValidMemoryLevels {
		memories, err := s.storage.ListByLevel(ctx, level)
		if err != nil {
			continue
		}

		// Find duplicates using embedding similarity
		seen := make(map[string]bool)
		for i, m1 := range memories {
			if seen[m1.ID] {
				continue
			}

			for j := i + 1; j < len(memories); j++ {
				m2 := memories[j]
				if seen[m2.ID] {
					continue
				}

				// Calculate similarity
				similarity := cosineSimilarity(m1.Embedding, m2.Embedding)
				if similarity >= s.config.DuplicatesThreshold {
					if dryRun {
						details = append(details, fmt.Sprintf("[dry-run] would remove duplicate: %s (similar to %s, score: %.3f)", m2.ID[:8], m1.ID[:8], similarity))
					} else {
						if err := s.storage.DeleteConsolidated(ctx, m2.ID); err == nil {
							details = append(details, fmt.Sprintf("removed duplicate: %s (similar to %s)", m2.ID[:8], m1.ID[:8]))
							removed++
						}
					}
					seen[m2.ID] = true
				}
			}
		}
	}

	return removed, details, nil
}

// archiveEpisodic archives episodic memories older than the threshold
func (s *AutopruneService) archiveEpisodic(ctx context.Context, olderThan time.Duration, dryRun bool) (int, []string, error) {
	var details []string
	before := time.Now().Add(-olderThan)

	if dryRun {
		// Count what would be archived
		memories, err := s.storage.ListByLevel(ctx, memory.MemoryLevelEpisodic)
		if err != nil {
			return 0, nil, err
		}

		count := 0
		for _, m := range memories {
			if m.CreatedAt.Before(before) {
				details = append(details, fmt.Sprintf("[dry-run] would archive: %s (created: %s)", m.ID[:8], m.CreatedAt.Format("2006-01-02")))
				count++
			}
		}
		return count, details, nil
	}

	count, err := s.storage.ArchiveOlderThan(ctx, memory.MemoryLevelEpisodic, before)
	if err != nil {
		return 0, nil, err
	}

	if count > 0 {
		details = append(details, fmt.Sprintf("archived %d episodic memories older than %v", count, olderThan))
	}

	return count, details, nil
}

// mergeSemantic merges similar semantic memories
func (s *AutopruneService) mergeSemantic(ctx context.Context, dryRun bool) (int, []string, error) {
	var details []string
	merged := 0

	memories, err := s.storage.ListByLevel(ctx, memory.MemoryLevelSemantic)
	if err != nil {
		return 0, nil, err
	}

	// Track which memories have been merged
	mergedIDs := make(map[string]bool)

	for i, m1 := range memories {
		if mergedIDs[m1.ID] {
			continue
		}

		var toMerge []*memory.ConsolidatedMemory
		for j := i + 1; j < len(memories); j++ {
			m2 := memories[j]
			if mergedIDs[m2.ID] {
				continue
			}

			similarity := cosineSimilarity(m1.Embedding, m2.Embedding)
			if similarity >= s.config.SemanticMergeThreshold {
				toMerge = append(toMerge, m2)
				mergedIDs[m2.ID] = true
			}
		}

		if len(toMerge) > 0 {
			if dryRun {
				ids := make([]string, len(toMerge))
				for i, m := range toMerge {
					ids[i] = m.ID[:8]
				}
				details = append(details, fmt.Sprintf("[dry-run] would merge %d memories into %s", len(toMerge), m1.ID[:8]))
			} else {
				// Merge content from all memories
				mergedContent := m1.Content
				sourceIDs := make([]string, 0, len(toMerge))
				for _, m := range toMerge {
					mergedContent += "\n\n---\n\n" + m.Content
					sourceIDs = append(sourceIDs, m.ID)
				}

				// Generate new embedding for merged content
				newEmbedding, err := s.embedder.Embed(ctx, mergedContent)
				if err != nil {
					continue
				}

				// Perform the merge
				if err := s.storage.Merge(ctx, m1.ID, sourceIDs, mergedContent, newEmbedding); err != nil {
					continue
				}

				details = append(details, fmt.Sprintf("merged %d memories into %s", len(toMerge), m1.ID[:8]))
				merged += len(toMerge)
			}
		}
	}

	return merged, details, nil
}

// cosineSimilarity calculates cosine similarity between two vectors
func cosineSimilarity(a, b []float64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}

	var dotProduct, normA, normB float64
	for i := range a {
		dotProduct += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	if normA == 0 || normB == 0 {
		return 0
	}

	return dotProduct / (sqrt(normA) * sqrt(normB))
}

// sqrt is a simple square root implementation
func sqrt(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x == 0 {
		return 0
	}
	z := x
	for i := 0; i < 100; i++ {
		z = (z + x/z) / 2
	}
	return z
}
