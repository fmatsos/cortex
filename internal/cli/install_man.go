package cli

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

//go:embed manpage/cortex.1
var manPage []byte

var installManCmd = &cobra.Command{
	Use:   "install-man",
	Short: "Install the cortex man page",
	Long: `Install the cortex(1) man page to the system or user man directory.

By default, installs to ~/.local/share/man/man1/. Use --dir to specify
a custom directory, or --system to install to /usr/local/share/man/man1/
(requires appropriate permissions).`,
	RunE: runInstallMan,
}

var (
	manDir       string
	systemInstall bool
)

func init() {
	installManCmd.Flags().StringVar(&manDir, "dir", "", "Custom man page directory")
	installManCmd.Flags().BoolVar(&systemInstall, "system", false, "Install to /usr/local/share/man (requires sudo)")
	rootCmd.AddCommand(installManCmd)
}

func runInstallMan(cmd *cobra.Command, args []string) error {
	var targetDir string

	switch {
	case manDir != "":
		targetDir = manDir
	case systemInstall:
		targetDir = "/usr/local/share/man/man1"
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		targetDir = filepath.Join(home, ".local", "share", "man", "man1")
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", targetDir, err)
	}

	// Write man page
	manPath := filepath.Join(targetDir, "cortex.1")
	if err := os.WriteFile(manPath, manPage, 0644); err != nil {
		return fmt.Errorf("failed to write man page: %w", err)
	}

	fmt.Printf("Man page installed to: %s\n", manPath)
	fmt.Println()
	fmt.Println("To use the man page, you may need to:")
	fmt.Println("  1. Add the directory to MANPATH:")
	fmt.Printf("     export MANPATH=\"%s:$MANPATH\"\n", filepath.Dir(targetDir))
	fmt.Println("  2. Or run 'mandb' to update the man database (if installed system-wide)")
	fmt.Println()
	fmt.Println("Then run: man cortex")

	return nil
}
