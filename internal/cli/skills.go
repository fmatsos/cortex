package cli

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	cortexskills "github.com/cortex-ai/cortex-ai/skills"
	"github.com/spf13/cobra"
)

var skillsCmd = &cobra.Command{
	Use:   "skills",
	Short: "Manage Cortex agent skills",
}

var skillsInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install Cortex skill files for Claude Code and/or GitHub Copilot",
	Long: `Install the Cortex skill files into the agent skill directories.

By default, installs locally (project-level) for both Claude Code and Copilot.

Target directories:
  Claude Code (local):  .claude/skills/cortex/
  Claude Code (global): ~/.claude/skills/cortex/
  Copilot     (local):  .github/skills/cortex/
  Copilot     (global): ~/.copilot/skills/cortex/

Examples:
  cortex skills install                  # local install for both agents
  cortex skills install --claude         # local install for Claude Code only
  cortex skills install --copilot        # local install for Copilot only
  cortex skills install --global         # global install for both agents
  cortex skills install --claude --global # global install for Claude Code only`,
	RunE: runSkillsInstall,
}

var (
	skillsInstallClaude  bool
	skillsInstallCopilot bool
	skillsInstallGlobal  bool
	skillsInstallForce   bool
)

func init() {
	skillsInstallCmd.Flags().BoolVar(&skillsInstallClaude, "claude", false, "Install for Claude Code only")
	skillsInstallCmd.Flags().BoolVar(&skillsInstallCopilot, "copilot", false, "Install for GitHub Copilot only")
	skillsInstallCmd.Flags().BoolVar(&skillsInstallGlobal, "global", false, "Install globally (~/.claude or ~/.copilot) instead of project-local")
	skillsInstallCmd.Flags().BoolVar(&skillsInstallForce, "force", false, "Overwrite existing skill files")
	skillsCmd.AddCommand(skillsInstallCmd)
	rootCmd.AddCommand(skillsCmd)
}

func runSkillsInstall(cmd *cobra.Command, _ []string) error {
	installClaude := skillsInstallClaude || (!skillsInstallClaude && !skillsInstallCopilot)
	installCopilot := skillsInstallCopilot || (!skillsInstallClaude && !skillsInstallCopilot)

	var errs []error

	if installClaude {
		base := ".claude"
		if skillsInstallGlobal {
			home, err := os.UserHomeDir()
			if err != nil {
				return fmt.Errorf("could not determine home directory: %w", err)
			}
			base = filepath.Join(home, ".claude")
		}
		dest := filepath.Join(base, "skills", "cortex")
		if err := installSkillFiles(cmd, dest); err != nil {
			errs = append(errs, fmt.Errorf("claude: %w", err))
		}
	}

	if installCopilot {
		base := ".github"
		if skillsInstallGlobal {
			home, err := os.UserHomeDir()
			if err != nil {
				return fmt.Errorf("could not determine home directory: %w", err)
			}
			base = filepath.Join(home, ".copilot")
		}
		dest := filepath.Join(base, "skills", "cortex")
		if err := installSkillFiles(cmd, dest); err != nil {
			errs = append(errs, fmt.Errorf("copilot: %w", err))
		}
	}

	if len(errs) > 0 {
		for _, e := range errs {
			_, _ = fmt.Fprintln(cmd.ErrOrStderr(), "error:", e)
		}
		return fmt.Errorf("skill installation encountered errors")
	}
	return nil
}

// installSkillFiles copies the embedded skill files to destDir.
func installSkillFiles(cmd *cobra.Command, destDir string) error {
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", destDir, err)
	}

	skillsFS, err := fs.Sub(cortexskills.FS, "cortex")
	if err != nil {
		return fmt.Errorf("failed to read embedded skills: %w", err)
	}

	return fs.WalkDir(skillsFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(destDir, filepath.FromSlash(path))
		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		if !skillsInstallForce {
			if _, statErr := os.Stat(dest); statErr == nil {
				_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  skip   %s (use --force to overwrite)\n", dest)
				return nil
			}
		}
		data, readErr := fs.ReadFile(skillsFS, path)
		if readErr != nil {
			return fmt.Errorf("read %s: %w", path, readErr)
		}
		if writeErr := os.WriteFile(dest, data, 0644); writeErr != nil {
			return fmt.Errorf("write %s: %w", dest, writeErr)
		}
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  write  %s\n", dest)
		return nil
	})
}
