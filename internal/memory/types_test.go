package memory

import (
	"strings"
	"testing"
	"time"
)

func TestIsValidLevel(t *testing.T) {
	tests := []struct {
		level    string
		expected bool
	}{
		{"working", true},
		{"episodic", true},
		{"semantic", true},
		{"invalid", false},
		{"", false},
		{"WORKING", false}, // case sensitive
	}

	for _, tt := range tests {
		t.Run(tt.level, func(t *testing.T) {
			result := IsValidLevel(tt.level)
			if result != tt.expected {
				t.Errorf("IsValidLevel(%q) = %v, want %v", tt.level, result, tt.expected)
			}
		})
	}
}

func TestIsValidSource(t *testing.T) {
	tests := []struct {
		source   string
		expected bool
	}{
		{"manual", true},
		{"auto", true},
		{"llm", true},
		{"invalid", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.source, func(t *testing.T) {
			result := IsValidSource(tt.source)
			if result != tt.expected {
				t.Errorf("IsValidSource(%q) = %v, want %v", tt.source, result, tt.expected)
			}
		})
	}
}

func TestConsolidateInput_Validate(t *testing.T) {
	tests := []struct {
		name    string
		input   ConsolidateInput
		wantErr bool
	}{
		{
			name: "valid input",
			input: ConsolidateInput{
				Synthesis: "test synthesis",
				Level:     MemoryLevelWorking,
				Context: MemoryContext{
					SessionID: "session123",
					Source:    "manual",
				},
			},
			wantErr: false,
		},
		{
			name: "empty synthesis",
			input: ConsolidateInput{
				Synthesis: "",
				Level:     MemoryLevelWorking,
				Context: MemoryContext{
					SessionID: "session123",
				},
			},
			wantErr: true,
		},
		{
			name: "invalid level",
			input: ConsolidateInput{
				Synthesis: "test",
				Level:     MemoryLevel("invalid"),
				Context: MemoryContext{
					SessionID: "session123",
				},
			},
			wantErr: true,
		},
		{
			name: "missing session ID",
			input: ConsolidateInput{
				Synthesis: "test",
				Level:     MemoryLevelWorking,
				Context: MemoryContext{
					SessionID: "",
				},
			},
			wantErr: true,
		},
		{
			name: "invalid source",
			input: ConsolidateInput{
				Synthesis: "test",
				Level:     MemoryLevelWorking,
				Context: MemoryContext{
					SessionID: "session123",
					Source:    "invalid",
				},
			},
			wantErr: true,
		},
		{
			name: "empty source is valid",
			input: ConsolidateInput{
				Synthesis: "test",
				Level:     MemoryLevelEpisodic,
				Context: MemoryContext{
					SessionID: "session123",
					Source:    "",
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.input.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidationError_Error(t *testing.T) {
	err := &ValidationError{
		Field:   "synthesis",
		Message: "synthesis is required",
	}

	expected := "synthesis: synthesis is required"
	if err.Error() != expected {
		t.Errorf("Error() = %q, want %q", err.Error(), expected)
	}
}

func TestMemory_TitleOrDerived(t *testing.T) {
	tests := []struct {
		name     string
		memory   Memory
		expected string
	}{
		{
			name:     "returns title when set",
			memory:   Memory{Title: "My Title", Content: "some content here"},
			expected: "My Title",
		},
		{
			name:     "derives from first line when title empty",
			memory:   Memory{Title: "", Content: "First line\nSecond line"},
			expected: "First line",
		},
		{
			name:     "derives from single-line content",
			memory:   Memory{Title: "", Content: "Only one line of content"},
			expected: "Only one line of content",
		},
		{
			name:     "truncates long first line",
			memory:   Memory{Title: "", Content: strings.Repeat("a", 70)},
			expected: strings.Repeat("a", 60) + "...",
		},
		{
			name:     "truncates long first line on rune boundaries",
			memory:   Memory{Title: "", Content: strings.Repeat("界", 61)},
			expected: strings.Repeat("界", 60) + "...",
		},
		{
			name:     "returns Memory for empty content",
			memory:   Memory{Title: "", Content: ""},
			expected: "Memory",
		},
		{
			name:     "returns Memory for whitespace content",
			memory:   Memory{Title: "", Content: "   \n   "},
			expected: "Memory",
		},
		{
			name:     "returns Memory for too-short first line",
			memory:   Memory{Title: "", Content: "ab\nMore content"},
			expected: "Memory",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.memory.TitleOrDerived()
			if result != tt.expected {
				t.Errorf("TitleOrDerived() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestMemory(t *testing.T) {
	now := time.Now()
	mem := &Memory{
		ID:      "test-id",
		Level:   MemoryLevelSemantic,
		Title:   "test title",
		Content: "test content",
		Context: MemoryContext{
			SessionID: "session123",
			Timestamp: now,
			Source:    "manual",
			Tags:      []string{"test", "unit"},
		},
		CreatedAt:  now,
		UpdatedAt:  now,
		MergedFrom: []string{"id1", "id2"},
	}

	if mem.ID != "test-id" {
		t.Errorf("ID = %q, want %q", mem.ID, "test-id")
	}
	if mem.Level != MemoryLevelSemantic {
		t.Errorf("Level = %q, want %q", mem.Level, MemoryLevelSemantic)
	}
	if len(mem.MergedFrom) != 2 {
		t.Errorf("MergedFrom length = %d, want 2", len(mem.MergedFrom))
	}
}
