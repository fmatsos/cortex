package markdown

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

func TestParseFrontmatter(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantTitle   string
		wantLevel   string
		wantBody    string
		wantErr     bool
		errContains string
	}{
		{
			name: "valid frontmatter with all fields",
			content: `---
id: test-id-123
title: Test Memory
level: episodic
tags:
  - go
  - testing
session_id: session-1
obsolete: false
---

This is the body content.`,
			wantTitle: "Test Memory",
			wantLevel: "episodic",
			wantBody:  "This is the body content.",
			wantErr:   false,
		},
		{
			name: "minimal frontmatter",
			content: `---
title: Minimal Memory
level: semantic
---

Body.`,
			wantTitle: "Minimal Memory",
			wantLevel: "semantic",
			wantBody:  "Body.",
			wantErr:   false,
		},
		{
			name:        "missing opening delimiter",
			content:     "title: Test\n---\nBody",
			wantErr:     true,
			errContains: "does not start with frontmatter",
		},
		{
			name:        "missing closing delimiter",
			content:     "---\ntitle: Test\n",
			wantErr:     true,
			errContains: "missing closing frontmatter",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseFrontmatter([]byte(tt.content))

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
				} else if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %q", tt.errContains, err.Error())
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result.Frontmatter.Title != tt.wantTitle {
				t.Errorf("title = %q, want %q", result.Frontmatter.Title, tt.wantTitle)
			}

			if result.Frontmatter.Level != tt.wantLevel {
				t.Errorf("level = %q, want %q", result.Frontmatter.Level, tt.wantLevel)
			}

			if strings.TrimSpace(result.Body) != strings.TrimSpace(tt.wantBody) {
				t.Errorf("body = %q, want %q", result.Body, tt.wantBody)
			}
		})
	}
}

func TestValidateFrontmatter(t *testing.T) {
	tests := []struct {
		name        string
		frontmatter *Frontmatter
		wantErr     bool
		errContains string
	}{
		{
			name: "valid frontmatter",
			frontmatter: &Frontmatter{
				Title: "Valid Memory",
				Level: "semantic",
			},
			wantErr: false,
		},
		{
			name: "missing title",
			frontmatter: &Frontmatter{
				Title: "",
				Level: "episodic",
			},
			wantErr:     true,
			errContains: "title is required",
		},
		{
			name: "missing level",
			frontmatter: &Frontmatter{
				Title: "No Level",
				Level: "",
			},
			wantErr:     true,
			errContains: "level is required",
		},
		{
			name: "invalid level",
			frontmatter: &Frontmatter{
				Title: "Invalid Level",
				Level: "invalid",
			},
			wantErr:     true,
			errContains: "invalid level",
		},
		{
			name: "working requires session",
			frontmatter: &Frontmatter{
				Title: "Working",
				Level: "working",
			},
			wantErr:     true,
			errContains: "session_id is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFrontmatter(tt.frontmatter)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
				} else if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %q", tt.errContains, err.Error())
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestExportAndImportMemory(t *testing.T) {
	tmpDir := t.TempDir()
	exporter := NewExporter(tmpDir)
	importer := NewImporter()

	mem := &memory.Memory{
		ID:        "test-id",
		Title:     "Test Memory",
		Content:   "Test content",
		Level:     memory.MemoryLevelEpisodic,
		Tags:      []string{"tag1"},
		Context:   memory.MemoryContext{SessionID: "session-1", Source: "manual", Timestamp: time.Now()},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	path, err := exporter.ExportMemory(mem)
	if err != nil {
		t.Fatalf("ExportMemory() error = %v", err)
	}

	imported, err := importer.ImportFile(path)
	if err != nil {
		t.Fatalf("ImportFile() error = %v", err)
	}

	if imported.Title != mem.Title {
		t.Errorf("Title = %q, want %q", imported.Title, mem.Title)
	}
	if imported.Level != mem.Level {
		t.Errorf("Level = %q, want %q", imported.Level, mem.Level)
	}
}

func TestExpandGlob(t *testing.T) {
	tempDir := t.TempDir()

	_ = os.WriteFile(filepath.Join(tempDir, "one.md"), []byte("---\n"), 0644)
	_ = os.WriteFile(filepath.Join(tempDir, "two.md"), []byte("---\n"), 0644)
	_ = os.WriteFile(filepath.Join(tempDir, "skip.txt"), []byte("---\n"), 0644)

	matches, err := ExpandGlob(filepath.Join(tempDir, "*"))
	if err != nil {
		t.Fatalf("ExpandGlob() error = %v", err)
	}

	if len(matches) != 2 {
		t.Errorf("ExpandGlob() count = %d, want 2", len(matches))
	}
}
