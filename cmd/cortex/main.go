package main

import (
	"fmt"
	"os"

	"github.com/cortex-ai/cortex-ai/internal/cli"
)

var Version = "dev"

func main() {
	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
