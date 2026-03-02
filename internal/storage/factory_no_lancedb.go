//go:build !lancedb

package storage

import "fmt"

func newLanceDBStorageOrError(_ string) (Storage, error) {
	return nil, fmt.Errorf("lancedb backend not compiled in; rebuild with -tags lancedb")
}
