package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/cortex-ai/cortex-ai/internal/config"
	"gopkg.in/natefinch/lumberjack.v2"
)

var (
	loggerMu sync.RWMutex
	logger   = slog.New(slog.NewTextHandler(io.Discard, nil))
)

// Initialize configures global rotating-file logging.
func Initialize(cfg config.LoggingConfig) error {
	if cfg.File == "" {
		return fmt.Errorf("logging file path is empty")
	}

	if err := os.MkdirAll(filepath.Dir(cfg.File), 0o755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	level, err := parseLevel(cfg.Level)
	if err != nil {
		return err
	}

	rotating := &lumberjack.Logger{
		Filename:   cfg.File,
		MaxSize:    cfg.MaxSizeMB,
		MaxBackups: cfg.MaxBackups,
		MaxAge:     cfg.MaxAgeDays,
		Compress:   cfg.Compress,
	}

	handler := slog.NewJSONHandler(rotating, &slog.HandlerOptions{Level: level})
	loggerMu.Lock()
	logger = slog.New(handler)
	loggerMu.Unlock()

	Info("logging initialized", "file", cfg.File, "level", strings.ToLower(cfg.Level))
	return nil
}

func parseLevel(level string) (slog.Leveler, error) {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warning", "warn":
		return slog.LevelWarn, nil
	case "critical":
		return slog.LevelError, nil
	default:
		return nil, fmt.Errorf("invalid logging level %q: use debug|info|warning|critical", level)
	}
}

// Logger returns the global logger instance.
func Logger() *slog.Logger {
	loggerMu.RLock()
	defer loggerMu.RUnlock()
	return logger
}

// Debug logs debug-level message.
func Debug(msg string, args ...any) {
	Logger().Debug(msg, args...)
}

// Info logs info-level message.
func Info(msg string, args ...any) {
	Logger().Info(msg, args...)
}

// Warning logs warning-level message.
func Warning(msg string, args ...any) {
	Logger().Warn(msg, args...)
}

// Critical logs critical-level message.
func Critical(msg string, args ...any) {
	Logger().Error(msg, args...)
}
