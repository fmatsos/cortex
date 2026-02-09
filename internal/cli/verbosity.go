package cli

import (
	"fmt"
	"os"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

const maxVerbosity = 3

func Verbosity() int {
	if verbosity < 0 {
		return 0
	}
	if verbosity > maxVerbosity {
		return maxVerbosity
	}
	return verbosity
}

func verbosef(level int, format string, args ...any) {
	if Verbosity() < level {
		return
	}
	_, _ = fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func logConfigDetails() {
	if Verbosity() == 0 {
		return
	}

	configFile := config.GlobalConfigFileUsed()
	if configFile == "" {
		verbosef(1, "Config: using defaults (no config file)")
	} else {
		verbosef(1, "Config: %s", configFile)
	}
}
