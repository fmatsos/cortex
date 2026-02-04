// Package session provides session ID derivation from git branch names
package session

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"github.com/google/uuid"
)

// Deriver handles session ID derivation from git branch names
type Deriver struct {
	cfg *config.SessionConfig
}

// NewDeriver creates a new session ID deriver
func NewDeriver(cfg *config.SessionConfig) *Deriver {
	return &Deriver{cfg: cfg}
}

// GetCurrentBranch returns the current git branch name
func GetCurrentBranch(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "--abbrev-ref", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get git branch: %w", err)
	}

	branch := strings.TrimSpace(string(output))
	if branch == "" {
		return "", fmt.Errorf("empty branch name")
	}

	return branch, nil
}

// DeriveSessionID derives a session ID from the current git branch
// Returns the session ID or an error if derivation fails
func (d *Deriver) DeriveSessionID(ctx context.Context) (string, error) {
	// Get current branch
	branch, err := GetCurrentBranch(ctx)
	if err != nil {
		if d.cfg.FallbackToUUID {
			return uuid.New().String(), nil
		}
		return "", fmt.Errorf("failed to get branch name: %w", err)
	}

	return d.DeriveFromBranch(branch)
}

// DeriveFromBranch derives a session ID from a given branch name
func (d *Deriver) DeriveFromBranch(branch string) (string, error) {
	// Strip prefix if configured
	if d.cfg.StripPrefix != "" {
		branch = strings.TrimPrefix(branch, d.cfg.StripPrefix)
	}

	var sessionID string
	var err error

	switch d.cfg.PatternType {
	case "prefix":
		sessionID = d.extractPrefix(branch)
	case "regex":
		sessionID, err = d.extractRegex(branch)
		if err != nil {
			if d.cfg.FallbackToUUID {
				return uuid.New().String(), nil
			}
			return "", err
		}
	case "full":
		sessionID = d.extractFull(branch)
	default:
		// Default to prefix mode
		sessionID = d.extractPrefix(branch)
	}

	// If empty and fallback is enabled, use UUID
	if sessionID == "" && d.cfg.FallbackToUUID {
		return uuid.New().String(), nil
	}

	if sessionID == "" {
		return "", fmt.Errorf("failed to derive session ID from branch: %s", branch)
	}

	return sessionID, nil
}

// extractPrefix extracts a prefix-based session ID
// Example: "fix/sil-123/do-implementation" -> "session-fix-sil-123"
func (d *Deriver) extractPrefix(branch string) string {
	// Replace slashes with configured separator
	parts := strings.Split(branch, "/")

	// Apply max segments limit
	if d.cfg.MaxSegments > 0 && len(parts) > d.cfg.MaxSegments {
		parts = parts[:d.cfg.MaxSegments]
	}

	// Join with separator
	sessionPart := strings.Join(parts, d.cfg.Separator)

	// Add prefix
	return d.cfg.Prefix + sessionPart
}

// extractRegex extracts session ID using a custom regex pattern
func (d *Deriver) extractRegex(branch string) (string, error) {
	if d.cfg.Pattern == "" {
		return "", fmt.Errorf("regex pattern is empty")
	}

	re, err := regexp.Compile(d.cfg.Pattern)
	if err != nil {
		return "", fmt.Errorf("invalid regex pattern: %w", err)
	}

	matches := re.FindStringSubmatch(branch)
	if len(matches) < 2 {
		return "", fmt.Errorf("regex pattern did not match branch: %s", branch)
	}

	// Use first capture group
	sessionPart := matches[1]

	// Replace slashes with separator
	sessionPart = strings.ReplaceAll(sessionPart, "/", d.cfg.Separator)

	// Add prefix
	return d.cfg.Prefix + sessionPart, nil
}

// extractFull uses the full branch name as session ID
func (d *Deriver) extractFull(branch string) string {
	// Replace slashes with separator
	sessionPart := strings.ReplaceAll(branch, "/", d.cfg.Separator)

	// Add prefix
	return d.cfg.Prefix + sessionPart
}

// DeriveOrUseProvided returns the provided session ID if not empty,
// otherwise derives it from the git branch
func (d *Deriver) DeriveOrUseProvided(ctx context.Context, providedSessionID string) (string, error) {
	// If session ID is explicitly provided, use it
	if providedSessionID != "" {
		return providedSessionID, nil
	}

	// If auto-derive is disabled, return empty
	if !d.cfg.AutoDerive {
		return "", nil
	}

	// Derive from git branch
	return d.DeriveSessionID(ctx)
}
