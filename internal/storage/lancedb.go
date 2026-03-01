//go:build lancedb

package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/apache/arrow/go/v17/arrow"
	"github.com/apache/arrow/go/v17/arrow/array"
	arrowmem "github.com/apache/arrow/go/v17/arrow/memory"
	"github.com/lancedb/lancedb-go/pkg/contracts"
	lancedb "github.com/lancedb/lancedb-go/pkg/lancedb"

	"github.com/cortex-ai/cortex-ai/internal/memory"
	"github.com/cortex-ai/cortex-ai/internal/search"
)

// lancedbLevels is the ordered list of the three memory-layer table names.
var lancedbLevels = []string{
	string(memory.MemoryLevelWorking),
	string(memory.MemoryLevelEpisodic),
	string(memory.MemoryLevelSemantic),
}

// LanceDBStorage implements Storage using LanceDB as a vector database backend.
// Compiled only when the "lancedb" build tag is provided.
//
// Three tables are maintained — one per memory level — and created lazily on
// the first Save(), when the embedding dimension becomes known.
type LanceDBStorage struct {
	conn     contracts.IConnection
	tables   map[string]contracts.ITable // keyed by MemoryLevel string
	tablesMu sync.RWMutex

	// dim is 0 until the first Save(); it never changes afterward.
	// schema is derived from dim and cached here so all three tables share it.
	dim    int
	schema *arrow.Schema
	dimMu  sync.Mutex

	path string
}

// NewLanceDBStorage connects to a LanceDB database at path.
// Any tables that already exist are opened so that queries work
// immediately on a restarted process, even before a new Save() is issued.
func NewLanceDBStorage(path string) (*LanceDBStorage, error) {
	ctx := context.Background()
	conn, err := lancedb.Connect(ctx, path, nil)
	if err != nil {
		return nil, fmt.Errorf("lancedb connect: %w", err)
	}
	s := &LanceDBStorage{
		conn:   conn,
		tables: make(map[string]contracts.ITable),
		path:   path,
	}
	if err := s.openExistingTables(ctx); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return s, nil
}

// openExistingTables opens any already-existing level tables and seeds s.dim
// from the stored vector field's fixed-size list length.
// Called only from the constructor; no locking needed at this stage.
func (s *LanceDBStorage) openExistingTables(ctx context.Context) error {
	for _, level := range lancedbLevels {
		tbl, err := s.conn.OpenTable(ctx, level)
		if err != nil {
			// Table does not exist yet; skip.
			continue
		}
		s.tables[level] = tbl

		// Seed the dimension once from the first found table's Arrow schema.
		if s.dim == 0 {
			arrowSchema, schemaErr := tbl.Schema(ctx)
			if schemaErr != nil {
				return fmt.Errorf("read schema from %s table: %w", level, schemaErr)
			}
			for i := 0; i < arrowSchema.NumFields(); i++ {
				f := arrowSchema.Field(i)
				if f.Name == "vector" {
					if listType, ok := f.Type.(*arrow.FixedSizeListType); ok {
						s.dim = int(listType.Len())
						s.schema = arrowSchema
					}
					break
				}
			}
		}
	}
	return nil
}

// buildArrowSchema returns the Arrow schema for a memory table with the given embedding dimension.
// All three tables (working, episodic, semantic) use the same schema; the level is stored
// as a plain string column so cross-table queries can still inspect it.
func buildArrowSchema(dim int) *arrow.Schema {
	return arrow.NewSchema([]arrow.Field{
		{Name: "id", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "vector", Type: arrow.FixedSizeListOf(int32(dim), arrow.PrimitiveTypes.Float32), Nullable: false},
		{Name: "title", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "content", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "tags", Type: arrow.BinaryTypes.String, Nullable: false}, // JSON []string
		{Name: "level", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "session_id", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "task_id", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "author", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "source", Type: arrow.BinaryTypes.String, Nullable: false},
		{Name: "related_memories", Type: arrow.BinaryTypes.String, Nullable: false}, // JSON []string
		{Name: "merged_from", Type: arrow.BinaryTypes.String, Nullable: false},      // JSON []string
		{Name: "obsolete", Type: arrow.FixedWidthTypes.Boolean, Nullable: false},
		{Name: "created_at", Type: arrow.PrimitiveTypes.Int64, Nullable: false},    // UnixNano
		{Name: "updated_at", Type: arrow.PrimitiveTypes.Int64, Nullable: false},    // UnixNano
		{Name: "ctx_timestamp", Type: arrow.PrimitiveTypes.Int64, Nullable: false}, // MemoryContext.Timestamp UnixNano
	}, nil)
}

// ensureTable returns the table for the given level, creating it if it does not yet exist.
// The first call from Save() sets the embedding dimension for all future tables.
// Thread-safe: uses a double-checked lock with dimMu guarding creation.
func (s *LanceDBStorage) ensureTable(ctx context.Context, level string, dim int) (contracts.ITable, error) {
	// Fast path: table already open.
	s.tablesMu.RLock()
	if t, ok := s.tables[level]; ok {
		s.tablesMu.RUnlock()
		return t, nil
	}
	s.tablesMu.RUnlock()

	// Slow path: acquire creation lock and double-check.
	s.dimMu.Lock()
	defer s.dimMu.Unlock()

	s.tablesMu.RLock()
	if t, ok := s.tables[level]; ok {
		s.tablesMu.RUnlock()
		return t, nil
	}
	s.tablesMu.RUnlock()

	// Set dimension on first use; reject inconsistent later callers.
	if s.dim == 0 {
		s.dim = dim
		s.schema = buildArrowSchema(dim)
	} else if s.dim != dim {
		return nil, fmt.Errorf("embedding dimension mismatch: stored %d, got %d", s.dim, dim)
	}

	ldbSchema, err := lancedb.NewSchema(s.schema)
	if err != nil {
		return nil, fmt.Errorf("build lancedb schema: %w", err)
	}

	tbl, err := s.conn.CreateTable(ctx, level, ldbSchema)
	if err != nil {
		// Another process may have raced us; try opening the existing table.
		tbl, err = s.conn.OpenTable(ctx, level)
		if err != nil {
			return nil, fmt.Errorf("create/open table %q: %w", level, err)
		}
	}

	s.tablesMu.Lock()
	s.tables[level] = tbl
	s.tablesMu.Unlock()
	return tbl, nil
}

// Save persists m to the table corresponding to its Level.
// The embedding must be non-empty; its length determines the vector dimension
// on the first call and is enforced on all subsequent calls.
func (s *LanceDBStorage) Save(ctx context.Context, m *memory.Memory) error {
	if len(m.Embedding) == 0 {
		return fmt.Errorf("memory %s has no embedding", m.ID)
	}
	tbl, err := s.ensureTable(ctx, string(m.Level), len(m.Embedding))
	if err != nil {
		return fmt.Errorf("save: %w", err)
	}
	rec, err := s.memoryToRecord(m)
	if err != nil {
		return fmt.Errorf("save: %w", err)
	}
	defer rec.Release()
	if err := tbl.Add(ctx, rec, nil); err != nil {
		return fmt.Errorf("save: add record: %w", err)
	}
	return nil
}

// memoryToRecord converts a Memory into a one-row Arrow Record.
// The caller is responsible for calling rec.Release().
func (s *LanceDBStorage) memoryToRecord(m *memory.Memory) (arrow.Record, error) {
	pool := arrowmem.NewGoAllocator()

	tagsJSON, err := json.Marshal(m.Tags)
	if err != nil {
		return nil, fmt.Errorf("marshal tags: %w", err)
	}
	relatedJSON, err := json.Marshal(m.Context.RelatedMemories)
	if err != nil {
		return nil, fmt.Errorf("marshal related_memories: %w", err)
	}
	mergedJSON, err := json.Marshal(m.MergedFrom)
	if err != nil {
		return nil, fmt.Errorf("marshal merged_from: %w", err)
	}

	newStr := func(val string) arrow.Array {
		b := array.NewStringBuilder(pool)
		b.Append(val)
		return b.NewArray()
	}
	newBool := func(val bool) arrow.Array {
		b := array.NewBooleanBuilder(pool)
		b.Append(val)
		return b.NewArray()
	}
	newI64 := func(val int64) arrow.Array {
		b := array.NewInt64Builder(pool)
		b.Append(val)
		return b.NewArray()
	}

	// Build the vector column: FixedSizeList<Float32>.
	f32vals := float64ToFloat32Slice(m.Embedding)
	floatB := array.NewFloat32Builder(pool)
	floatB.AppendValues(f32vals, nil)
	floatArr := floatB.NewArray()
	listType := arrow.FixedSizeListOf(int32(len(m.Embedding)), arrow.PrimitiveTypes.Float32)
	listData := array.NewData(listType, 1, []*arrowmem.Buffer{nil}, []arrow.ArrayData{floatArr.Data()}, 0, 0)
	vecArr := array.NewFixedSizeListData(listData)

	cols := []arrow.Array{
		newStr(m.ID),
		vecArr,
		newStr(m.Title),
		newStr(m.Content),
		newStr(string(tagsJSON)),
		newStr(string(m.Level)),
		newStr(m.Context.SessionID),
		newStr(m.Context.TaskID),
		newStr(m.Context.Author),
		newStr(m.Context.Source),
		newStr(string(relatedJSON)),
		newStr(string(mergedJSON)),
		newBool(m.Obsolete),
		newI64(m.CreatedAt.UnixNano()),
		newI64(m.UpdatedAt.UnixNano()),
		newI64(m.Context.Timestamp.UnixNano()),
	}

	rec := array.NewRecord(s.schema, cols, 1)

	// Release intermediate arrays; the record has retained them.
	floatArr.Release()
	vecArr.Release()
	for _, col := range cols {
		col.Release()
	}

	return rec, nil
}

// arrowRowToMemory converts a result map (from LanceDB's JSON-decoded output) to a Memory.
func arrowRowToMemory(row map[string]interface{}) (*memory.Memory, error) {
	getString := func(key string) string {
		if v, ok := row[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}
	getBool := func(key string) bool {
		if v, ok := row[key]; ok {
			if b, ok := v.(bool); ok {
				return b
			}
		}
		return false
	}
	getInt64 := func(key string) int64 {
		if v, ok := row[key]; ok {
			switch n := v.(type) {
			case float64:
				return int64(n)
			case int64:
				return n
			case json.Number:
				i, _ := n.Int64()
				return i
			}
		}
		return 0
	}
	getVec := func(key string) []float64 {
		if v, ok := row[key]; ok {
			if items, ok := v.([]interface{}); ok {
				out := make([]float64, len(items))
				for i, item := range items {
					if f, ok := item.(float64); ok {
						out[i] = f
					}
				}
				return out
			}
		}
		return nil
	}
	parseStrSlice := func(key string) []string {
		s := getString(key)
		if s == "" || s == "null" {
			return nil
		}
		var out []string
		if jsonErr := json.Unmarshal([]byte(s), &out); jsonErr != nil {
			return nil
		}
		return out
	}
	fromNano := func(ns int64) time.Time {
		if ns == 0 {
			return time.Time{}
		}
		return time.Unix(0, ns)
	}

	m := &memory.Memory{
		ID:         getString("id"),
		Level:      memory.MemoryLevel(getString("level")),
		Title:      getString("title"),
		Content:    getString("content"),
		Tags:       parseStrSlice("tags"),
		Embedding:  getVec("vector"),
		Obsolete:   getBool("obsolete"),
		CreatedAt:  fromNano(getInt64("created_at")),
		UpdatedAt:  fromNano(getInt64("updated_at")),
		MergedFrom: parseStrSlice("merged_from"),
		Context: memory.MemoryContext{
			SessionID:       getString("session_id"),
			TaskID:          getString("task_id"),
			Author:          getString("author"),
			Source:          getString("source"),
			RelatedMemories: parseStrSlice("related_memories"),
			Timestamp:       fromNano(getInt64("ctx_timestamp")),
		},
	}
	if m.ID == "" {
		return nil, fmt.Errorf("missing id in row")
	}
	return m, nil
}

// Get retrieves a single memory by ID, searching across all level tables.
func (s *LanceDBStorage) Get(ctx context.Context, id string) (*memory.Memory, error) {
	filter := fmt.Sprintf("id = '%s'", escapeSQLString(id))
	s.tablesMu.RLock()
	tables := s.snapshotTables()
	s.tablesMu.RUnlock()

	for _, tbl := range tables {
		rows, err := tbl.SelectWithFilter(ctx, filter)
		if err != nil {
			return nil, fmt.Errorf("get: %w", err)
		}
		if len(rows) > 0 {
			return arrowRowToMemory(rows[0])
		}
	}
	return nil, fmt.Errorf("memory not found: %s", id)
}

// List returns memories across the specified levels with optional filtering and sorting.
func (s *LanceDBStorage) List(ctx context.Context, opts memory.ListOptions) ([]*memory.Memory, error) {
	levels := opts.FilterLevels
	if len(levels) == 0 {
		levels = memory.ValidMemoryLevels
	}

	filter := ""
	if !opts.IncludeObsolete {
		filter = "obsolete = false"
	}

	s.tablesMu.RLock()
	tables := s.snapshotTables()
	s.tablesMu.RUnlock()

	var results []*memory.Memory
	for _, level := range levels {
		tbl, ok := tables[string(level)]
		if !ok {
			continue
		}
		var rows []map[string]interface{}
		var err error
		if filter != "" {
			rows, err = tbl.SelectWithFilter(ctx, filter)
		} else {
			rows, err = tbl.Select(ctx, contracts.QueryConfig{})
		}
		if err != nil {
			return nil, fmt.Errorf("list %s: %w", level, err)
		}
		for _, row := range rows {
			m, decodeErr := arrowRowToMemory(row)
			if decodeErr != nil {
				return nil, fmt.Errorf("list decode: %w", decodeErr)
			}
			results = append(results, m)
		}
	}

	// Sort by CreatedAt descending (newest first); reverse if requested.
	sort.Slice(results, func(i, j int) bool {
		if opts.Reverse {
			return results[i].CreatedAt.Before(results[j].CreatedAt)
		}
		return results[i].CreatedAt.After(results[j].CreatedAt)
	})

	if opts.Limit > 0 && len(results) > opts.Limit {
		results = results[:opts.Limit]
	}
	return results, nil
}

// Delete removes the memory with the given ID from whichever table holds it.
func (s *LanceDBStorage) Delete(ctx context.Context, id string) error {
	predicate := fmt.Sprintf("id = '%s'", escapeSQLString(id))

	s.tablesMu.RLock()
	tables := s.snapshotTables()
	s.tablesMu.RUnlock()

	for _, tbl := range tables {
		rows, err := tbl.SelectWithFilter(ctx, predicate)
		if err != nil {
			return fmt.Errorf("delete: query: %w", err)
		}
		if len(rows) > 0 {
			return tbl.Delete(ctx, predicate)
		}
	}
	return fmt.Errorf("memory not found: %s", id)
}

// Update replaces an existing memory by deleting the old record and saving the new one.
// The level may change between the old and new memory (e.g. working → episodic).
func (s *LanceDBStorage) Update(ctx context.Context, m *memory.Memory) error {
	if err := s.Delete(ctx, m.ID); err != nil {
		return fmt.Errorf("update: %w", err)
	}
	return s.Save(ctx, m)
}

// SearchAllLayers performs concurrent ANN vector search across the specified memory levels.
// Results are post-filtered by MinScore, deduplicated by ID, sorted by score descending,
// and truncated to TopK.
func (s *LanceDBStorage) SearchAllLayers(
	ctx context.Context,
	vector []float64,
	opts memory.SearchOptions,
) ([]*memory.SearchResult, error) {
	levels := opts.FilterLevels
	if len(levels) == 0 {
		levels = memory.ValidMemoryLevels
	}

	// Request more than TopK to account for post-score filtering.
	fetchK := opts.TopK * 3
	if opts.TopK <= 0 || fetchK < 20 {
		fetchK = 100
	}

	queryVec32 := float64ToFloat32Slice(vector)

	s.tablesMu.RLock()
	tables := s.snapshotTables()
	s.tablesMu.RUnlock()

	type tableResult struct {
		rows []map[string]interface{}
		err  error
	}
	ch := make(chan tableResult, len(levels))

	for _, level := range levels {
		level := level // capture loop variable
		tbl, ok := tables[string(level)]
		if !ok {
			ch <- tableResult{} // table not yet created; no results
			continue
		}

		go func() {
			filter := buildSearchFilter(level, opts)
			var rows []map[string]interface{}
			var err error
			if filter != "" {
				rows, err = tbl.VectorSearchWithFilter(ctx, "vector", queryVec32, fetchK, filter)
			} else {
				rows, err = tbl.VectorSearch(ctx, "vector", queryVec32, fetchK)
			}
			ch <- tableResult{rows: rows, err: err}
		}()
	}

	var allResults []*memory.SearchResult
	for range levels {
		res := <-ch
		if res.err != nil {
			return nil, res.err
		}
		for _, row := range res.rows {
			m, err := arrowRowToMemory(row)
			if err != nil {
				return nil, err
			}
			if len(m.Embedding) == 0 {
				continue
			}
			// Compute cosine similarity in Go for consistency with GobStorage.
			score := search.CosineSimilarity(vector, m.Embedding)
			if score < opts.MinScore {
				continue
			}
			allResults = append(allResults, &memory.SearchResult{Memory: m, Score: score})
		}
	}

	// Deduplicate by ID.
	seen := make(map[string]struct{}, len(allResults))
	deduped := allResults[:0]
	for _, r := range allResults {
		if _, exists := seen[r.Memory.ID]; !exists {
			seen[r.Memory.ID] = struct{}{}
			deduped = append(deduped, r)
		}
	}

	sort.Slice(deduped, func(i, j int) bool {
		return deduped[i].Score > deduped[j].Score
	})
	if opts.TopK > 0 && len(deduped) > opts.TopK {
		deduped = deduped[:opts.TopK]
	}
	return deduped, nil
}

// buildSearchFilter constructs the SQL WHERE clause for a vector search query.
// Returns an empty string when no filter conditions apply.
func buildSearchFilter(level memory.MemoryLevel, opts memory.SearchOptions) string {
	var parts []string
	if !opts.IncludeObsolete {
		parts = append(parts, "obsolete = false")
	}
	if level == memory.MemoryLevelWorking && opts.SessionID != "" {
		parts = append(parts, fmt.Sprintf("session_id = '%s'", escapeSQLString(opts.SessionID)))
	}
	return strings.Join(parts, " AND ")
}

// TransferWorkingToEpisodic reads all working memories for sessionID,
// writes them to the episodic table with their level updated, then deletes
// them from the working table.
//
// Note: this operation is not transactional. A crash between the write and
// the delete will leave duplicates; run `cortex memory delete <id>` to clean up.
func (s *LanceDBStorage) TransferWorkingToEpisodic(ctx context.Context, sessionID string) (int, error) {
	s.tablesMu.RLock()
	workingTbl, ok := s.tables[string(memory.MemoryLevelWorking)]
	s.tablesMu.RUnlock()

	if !ok {
		return 0, fmt.Errorf("session not found: %s (working table does not exist)", sessionID)
	}

	filter := fmt.Sprintf("session_id = '%s'", escapeSQLString(sessionID))
	rows, err := workingTbl.SelectWithFilter(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("transfer: query working: %w", err)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("session not found: %s", sessionID)
	}

	memories := make([]*memory.Memory, 0, len(rows))
	for _, row := range rows {
		m, decodeErr := arrowRowToMemory(row)
		if decodeErr != nil {
			return 0, fmt.Errorf("transfer: decode: %w", decodeErr)
		}
		m.Level = memory.MemoryLevelEpisodic
		memories = append(memories, m)
	}

	if len(memories) > 0 {
		episodicTbl, ensureErr := s.ensureTable(ctx, string(memory.MemoryLevelEpisodic), len(memories[0].Embedding))
		if ensureErr != nil {
			return 0, fmt.Errorf("transfer: ensure episodic table: %w", ensureErr)
		}
		for _, m := range memories {
			rec, recErr := s.memoryToRecord(m)
			if recErr != nil {
				return 0, fmt.Errorf("transfer: encode: %w", recErr)
			}
			if addErr := episodicTbl.Add(ctx, rec, nil); addErr != nil {
				rec.Release()
				return 0, fmt.Errorf("transfer: write episodic: %w", addErr)
			}
			rec.Release()
		}
	}

	if err := workingTbl.Delete(ctx, filter); err != nil {
		return 0, fmt.Errorf("transfer: delete working: %w", err)
	}
	return len(memories), nil
}

// Close closes all open tables and the underlying database connection.
func (s *LanceDBStorage) Close() error {
	s.tablesMu.Lock()
	defer s.tablesMu.Unlock()
	var firstErr error
	for _, tbl := range s.tables {
		if err := tbl.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if err := s.conn.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

// snapshotTables returns a shallow copy of s.tables.
// The caller must hold tablesMu.RLock() before calling this.
func (s *LanceDBStorage) snapshotTables() map[string]contracts.ITable {
	snap := make(map[string]contracts.ITable, len(s.tables))
	for k, v := range s.tables {
		snap[k] = v
	}
	return snap
}

// float64ToFloat32Slice casts each element from float64 to float32.
func float64ToFloat32Slice(in []float64) []float32 {
	out := make([]float32, len(in))
	for i, v := range in {
		out[i] = float32(v)
	}
	return out
}

// escapeSQLString escapes single-quote characters for use in SQL string literals.
func escapeSQLString(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}
