package logging

import (
	"path/filepath"
	"testing"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

func TestInitializeCreatesLogFileAndAcceptsLevels(t *testing.T) {
	tmpDir := t.TempDir()

	for _, level := range []string{"debug", "info", "warning", "critical"} {
		err := Initialize(config.LoggingConfig{
			Level:      level,
			File:       filepath.Join(tmpDir, level, "cortex.log"),
			MaxSizeMB:  1,
			MaxBackups: 1,
			MaxAgeDays: 1,
			Compress:   false,
		})
		if err != nil {
			t.Fatalf("Initialize failed for level %s: %v", level, err)
		}
	}
}

func TestInitializeInvalidLevel(t *testing.T) {
	err := Initialize(config.LoggingConfig{File: filepath.Join(t.TempDir(), "cortex.log"), Level: "trace"})
	if err == nil {
		t.Fatal("expected error for invalid level")
	}
}
