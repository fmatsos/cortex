package cli

import (
	"context"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/embeddings"
	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/storage"
	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete [id]",
	Short: "Delete a memory",
	Long: `Delete a memory by ID or delete all obsolete memories.

Examples:
  cortex delete abc123
  cortex delete --obsolete`,
	RunE: runDelete,
}

var (
	deleteObsolete bool
	deleteForce    bool
)

func init() {
	deleteCmd.Flags().BoolVar(&deleteObsolete, "obsolete", false, "Delete all obsolete memories")
	deleteCmd.Flags().BoolVarP(&deleteForce, "force", "f", false, "Skip confirmation prompt")

	rootCmd.AddCommand(deleteCmd)
}

func runDelete(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Initialize embedder
	embedder, err := embeddings.NewOllamaEmbedder("", "nomic-embed-text", 0)
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize storage
	storageBackend, err := storage.NewGobStorage(".local/share/cortex-ai")
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer storageBackend.Close()

	// Create service
	svc := memory.NewMemoryService(storageBackend, embedder)

	if deleteObsolete {
		// Delete all obsolete memories
		memories, err := svc.List(ctx, memory.ListOptions{IncludeObsolete: true})
		if err != nil {
			return fmt.Errorf("failed to list memories: %w", err)
		}

		count := 0
		for _, m := range memories {
			if m.Obsolete {
				if err := svc.Delete(ctx, m.ID); err != nil {
					fmt.Printf("Failed to delete %s: %v\n", m.ID, err)
					continue
				}
				count++
			}
		}
		fmt.Printf("Deleted %d obsolete memories\n", count)
	} else {
		if len(args) == 0 {
			return fmt.Errorf("memory ID is required or use --obsolete flag")
		}

		id := args[0]

		// Delete the memory
		if err := svc.Delete(ctx, id); err != nil {
			return fmt.Errorf("failed to delete memory: %w", err)
		}

		fmt.Printf("Deleted memory: %s\n", id)
	}

	return nil
}
