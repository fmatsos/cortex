//go:build lancedb

package storage

func newLanceDBStorageOrError(path string) (Storage, error) {
	return NewLanceDBStorage(path)
}
