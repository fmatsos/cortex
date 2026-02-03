package markdown

import (
	"fmt"
	"strings"
)

// ValidationError represents a validation error with field information
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ValidationErrors is a collection of validation errors
type ValidationErrors []ValidationError

func (e ValidationErrors) Error() string {
	if len(e) == 0 {
		return ""
	}

	var msgs []string
	for _, err := range e {
		msgs = append(msgs, err.Error())
	}
	return fmt.Sprintf("validation failed: %s", strings.Join(msgs, "; "))
}

// IsValidLevel checks if a level string is valid
func IsValidLevel(level string) bool {
	for _, valid := range ValidLevels {
		if level == valid {
			return true
		}
	}
	return false
}

// ValidateFrontmatter validates a frontmatter struct for import
// Returns nil if valid, or ValidationErrors if not
func ValidateFrontmatter(fm *Frontmatter) error {
	var errs ValidationErrors

	// Check required fields
	if strings.TrimSpace(fm.Title) == "" {
		errs = append(errs, ValidationError{
			Field:   "title",
			Message: "title is required",
		})
	}

	if strings.TrimSpace(fm.Level) == "" {
		errs = append(errs, ValidationError{
			Field:   "level",
			Message: "level is required",
		})
	} else if !IsValidLevel(fm.Level) {
		errs = append(errs, ValidationError{
			Field:   "level",
			Message: fmt.Sprintf("invalid level '%s' (must be working|episodic|semantic)", fm.Level),
		})
	}

	if fm.Level == "working" && strings.TrimSpace(fm.SessionID) == "" {
		errs = append(errs, ValidationError{
			Field:   "session_id",
			Message: "session_id is required for working memories",
		})
	}

	if len(errs) > 0 {
		return errs
	}

	return nil
}

// ValidateForImport validates a ParseResult for import
// This includes frontmatter validation plus additional checks
func ValidateForImport(result *ParseResult) error {
	if result == nil {
		return fmt.Errorf("parse result is nil")
	}

	if result.Frontmatter == nil {
		return fmt.Errorf("frontmatter is nil")
	}

	// Validate frontmatter
	if err := ValidateFrontmatter(result.Frontmatter); err != nil {
		return err
	}

	// Body can be empty (content might be in title for short memories)
	// but warn if it's truly empty
	// For now, we allow empty body

	return nil
}

// ValidateLevel validates a level string.
func ValidateLevel(level string) error {
	if strings.TrimSpace(level) == "" {
		return fmt.Errorf("level is required")
	}
	if !IsValidLevel(level) {
		return fmt.Errorf("invalid level '%s' (must be working|episodic|semantic)", level)
	}
	return nil
}
