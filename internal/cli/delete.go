package cli

import (
	"context"
	"fmt"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/tui"
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

	// Initialize embedder from config
	embedder, err := initEmbedder()
	if err != nil {
		return fmt.Errorf("failed to initialize embedder: %w", err)
	}

	// Initialize storage from config
	storageBackend, err := initStorage()
	if err != nil {
		return fmt.Errorf("failed to initialize storage: %w", err)
	}
	defer func() { _ = storageBackend.Close() }()

	// Create service
	svc := memory.NewMemoryService(storageBackend, embedder)

	if deleteObsolete {
		memories, err := svc.List(ctx, memory.ListOptions{IncludeObsolete: true})
		if err != nil {
			return fmt.Errorf("failed to list memories: %w", err)
		}

		count := 0
		for _, m := range memories {
			if m.Obsolete {
				if err := svc.Delete(ctx, m.ID); err != nil {
					_, _ = fmt.Fprintln(cmd.ErrOrStderr(), tui.ErrMsg(fmt.Sprintf("failed to delete %s: %v", m.ID, err)))
					continue
				}
				count++
			}
		}
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.SuccessMsg(fmt.Sprintf("Deleted %d obsolete memor%s", count, func() string {
			if count == 1 {
				return "y"
			}
			return "ies"
		}())))
	} else {
		if len(args) == 0 {
			return fmt.Errorf("memory ID is required or use --obsolete flag")
		}

		id := args[0]

		if err := svc.Delete(ctx, id); err != nil {
			return fmt.Errorf("failed to delete memory: %w", err)
		}

		_, _ = fmt.Fprintln(cmd.OutOrStdout(), tui.SuccessMsg(fmt.Sprintf("Deleted memory %s", tui.ShortID(id))))
	}

	return nil
}
