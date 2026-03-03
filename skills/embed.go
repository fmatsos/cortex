// Package skills embeds the bundled Cortex skill files.
package skills

import "embed"

// FS contains the embedded skill files (cortex/ subtree).
//
//go:embed cortex
var FS embed.FS
