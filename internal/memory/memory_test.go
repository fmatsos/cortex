package memory

import (
	"testing"
)

func TestCreateInput_Validate(t *testing.T) {
	tests := []struct {
		name    string
		input   CreateInput
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid input with single type",
			input: CreateInput{
				Title:   "Test Memory",
				Content: "Test content",
				Types:   []MemoryType{MemoryTypeSolution},
			},
			wantErr: false,
		},
		{
			name: "valid input with multiple types",
			input: CreateInput{
				Title:   "Test Memory",
				Content: "Test content",
				Types:   []MemoryType{MemoryTypeIssue, MemoryTypeSolution},
			},
			wantErr: false,
		},
		{
			name: "missing title",
			input: CreateInput{
				Title:   "",
				Content: "Test content",
				Types:   []MemoryType{MemoryTypeSolution},
			},
			wantErr: true,
			errMsg:  "title is required",
		},
		{
			name: "missing content",
			input: CreateInput{
				Title:   "Test Memory",
				Content: "",
				Types:   []MemoryType{MemoryTypeSolution},
			},
			wantErr: true,
			errMsg:  "content is required",
		},
		{
			name: "missing types",
			input: CreateInput{
				Title:   "Test Memory",
				Content: "Test content",
				Types:   []MemoryType{},
			},
			wantErr: true,
			errMsg:  "at least one type is required",
		},
		{
			name: "invalid type",
			input: CreateInput{
				Title:   "Test Memory",
				Content: "Test content",
				Types:   []MemoryType{"invalid"},
			},
			wantErr: true,
			errMsg:  "invalid type",
		},
		{
			name: "whitespace title",
			input: CreateInput{
				Title:   "   ",
				Content: "Test content",
				Types:   []MemoryType{MemoryTypeSolution},
			},
			wantErr: true,
			errMsg:  "title is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.input.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && tt.errMsg != "" {
				if err == nil || !contains(err.Error(), tt.errMsg) {
					t.Errorf("Validate() error = %v, want error containing %q", err, tt.errMsg)
				}
			}
		})
	}
}

func TestIsValidType(t *testing.T) {
	tests := []struct {
		name string
		t    string
		want bool
	}{
		{"solution", "solution", true},
		{"issue", "issue", true},
		{"analysis", "analysis", true},
		{"rule", "rule", true},
		{"any", "any", true},
		{"invalid", "invalid", false},
		{"Solution", "Solution", false},
		{"SOLUTION", "SOLUTION", false},
		{"", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidType(tt.t)
			if got != tt.want {
				t.Errorf("IsValidType(%q) = %v, want %v", tt.t, got, tt.want)
			}
		})
	}
}

func contains(s, substr string) bool {
	for i := 0; i < len(s); i++ {
		if len(s[i:]) < len(substr) {
			break
		}
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
