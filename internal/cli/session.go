package cli

import (
	"crypto/sha256"
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Session management utilities",
}

var sessionIDCmd = &cobra.Command{
	Use:   "id",
	Short: "Print the deterministic session ID for the current git branch",
	Long: `Prints a deterministic UUID v5 derived from the current git branch name.

The same branch always produces the same UUID, making it stable across agent
restarts and usable by both Claude Code and GitHub Copilot hooks.

Falls back to the UUID for "default" when no git branch is detected.`,
	RunE: runSessionID,
}

func init() {
	sessionCmd.AddCommand(sessionIDCmd)
	rootCmd.AddCommand(sessionCmd)
}

// branchSessionID returns a deterministic UUID v5 derived from the given branch name.
// Uses SHA-256 of the branch name and formats the first 16 bytes as a UUID.
func branchSessionID(branch string) string {
	if branch == "" {
		branch = "default"
	}
	h := sha256.Sum256([]byte(branch))
	// Format as UUID: 8-4-4-4-12 hex characters from first 16 bytes of SHA-256.
	b := h[:16]
	b[6] = (b[6] & 0x0f) | 0x50 // version 5
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func runSessionID(_ *cobra.Command, _ []string) error {
	branch := currentGitBranch()
	_, _ = fmt.Println(branchSessionID(branch))
	return nil
}

// currentGitBranch returns the current git branch name, or "" if unavailable.
func currentGitBranch() string {
	out, err := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return ""
	}
	branch := strings.TrimSpace(string(out))
	if branch == "HEAD" {
		return ""
	}
	return branch
}
