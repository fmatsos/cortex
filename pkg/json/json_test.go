package json

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cortex-ai/cortex-ai/internal/memory"
)

func TestToMemoryJSON(t *testing.T) {
	mem := &memory.Memory{
		ID:        "test-id-123",
		Title:     "Test Memory",
		Content:   "This is test content.",
		Level:     memory.MemoryLevelEpisodic,
		Tags:      []string{"go", "testing"},
		Context:   memory.MemoryContext{SessionID: "session-1", Source: "manual", Timestamp: time.Now()},
		CreatedAt: time.Date(2024, 1, 15, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2024, 1, 15, 12, 0, 0, 0, time.UTC),
		Obsolete:  false,
	}

	mj := ToMemoryJSON(mem)

	if mj.ID != mem.ID {
		t.Errorf("ID = %q, want %q", mj.ID, mem.ID)
	}
	if mj.Title != mem.Title {
		t.Errorf("Title = %q, want %q", mj.Title, mem.Title)
	}
	if mj.Content != mem.Content {
		t.Errorf("Content = %q, want %q", mj.Content, mem.Content)
	}
	if mj.Level != string(mem.Level) {
		t.Errorf("Level = %q, want %q", mj.Level, mem.Level)
	}
}

func TestMemoryJSONToMemory(t *testing.T) {
	tests := []struct {
		name        string
		json        MemoryJSON
		wantErr     bool
		errContains string
	}{
		{
			name: "valid memory json",
			json: MemoryJSON{
				ID:        "test-id",
				Title:     "Test Memory",
				Content:   "Content here",
				Level:     "episodic",
				Tags:      []string{"test"},
				Context:   memory.MemoryContext{SessionID: "session-1", Source: "manual"},
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			},
			wantErr: false,
		},
		{
			name: "missing title",
			json: MemoryJSON{
				Content: "Content",
				Level:   "semantic",
			},
			wantErr:     true,
			errContains: "title is required",
		},
		{
			name: "missing level",
			json: MemoryJSON{
				Title:   "No Level",
				Content: "Content",
			},
			wantErr:     true,
			errContains: "level is required",
		},
		{
			name: "invalid level",
			json: MemoryJSON{
				Title:   "Invalid Level",
				Content: "Content",
				Level:   "invalid",
			},
			wantErr:     true,
			errContains: "invalid level",
		},
		{
			name: "generates ID when missing",
			json: MemoryJSON{
				Title:   "No ID",
				Content: "Content",
				Level:   "semantic",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mem, err := tt.json.ToMemory()
			if (err != nil) != tt.wantErr {
				t.Fatalf("ToMemory() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
				t.Fatalf("ToMemory() error = %v, want contains %q", err, tt.errContains)
			}
			if !tt.wantErr && mem.ID == "" {
				t.Error("ID should be generated")
			}
		})
	}
}

func TestExporter_Importer_RoundTrip(t *testing.T) {
	tempDir := t.TempDir()
	exporter := NewExporter(tempDir)
	importer := NewImporter()

	mem := &memory.Memory{
		ID:        "test-id",
		Title:     "Test Memory",
		Content:   "Test content",
		Level:     memory.MemoryLevelSemantic,
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

func TestValidateBytes(t *testing.T) {
	importer := NewImporter()

	valid := MemoryJSON{
		Title:   "Test",
		Content: "Content",
		Level:   "episodic",
	}
	data, _ := json.Marshal(valid)

	if err := importer.ValidateBytes(data); err != nil {
		t.Errorf("ValidateBytes() error = %v", err)
	}

	invalid := MemoryJSON{Title: "Test"}
	data, _ = json.Marshal(invalid)

	if err := importer.ValidateBytes(data); err == nil {
		t.Error("ValidateBytes() should fail for missing level")
	}
}

func TestExpandGlob(t *testing.T) {
	tempDir := t.TempDir()

	_ = os.WriteFile(filepath.Join(tempDir, "one.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(tempDir, "two.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(tempDir, "skip.txt"), []byte("{}"), 0644)

	matches, err := ExpandGlob(filepath.Join(tempDir, "*"))
	if err != nil {
		t.Fatalf("ExpandGlob() error = %v", err)
	}

	if len(matches) != 2 {
		t.Errorf("ExpandGlob() count = %d, want 2", len(matches))
	}
}
