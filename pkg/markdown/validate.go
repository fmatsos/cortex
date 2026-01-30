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

// IsValidType checks if a type string is valid
func IsValidType(t string) bool {
	for _, valid := range ValidTypes {
		if t == valid {
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

	if len(fm.Types) == 0 {
		errs = append(errs, ValidationError{
			Field:   "type",
			Message: "at least one type is required",
		})
	} else {
		// Validate each type
		for _, t := range fm.Types {
			if !IsValidType(t) {
				errs = append(errs, ValidationError{
					Field:   "type",
					Message: fmt.Sprintf("invalid type '%s' (must be solution|issue|analysis|rule|any)", t),
				})
			}
		}
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

// ValidateTypes validates a slice of type strings
func ValidateTypes(types []string) error {
	if len(types) == 0 {
		return fmt.Errorf("at least one type is required")
	}

	for _, t := range types {
		if !IsValidType(t) {
			return fmt.Errorf("invalid type '%s' (must be solution|issue|analysis|rule|any)", t)
		}
	}

	return nil
}
