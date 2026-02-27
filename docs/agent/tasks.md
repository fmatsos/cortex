# Common Development Tasks

## Adding a CLI Command

1. Create `internal/cli/<name>.go`
2. Define Cobra command with flags
3. Register in `root.go`
4. Add tests in `cli_test.go`
5. Update `docs/cli/reference.md`
6. Add JSON schema in `internal/schemas/cli/` if the command produces output

## Adding an MCP Tool

1. Define schema in `internal/schemas/mcp/`
2. Add tool handler in `internal/mcp/server.go`
3. Register name in `internal/schemas/embed.go` (`MCPToolNames`)
4. Add dispatch case in `handleCallTool()` switch
5. For thinking tools: add configurable prompt in `internal/config/config.go`
6. Update `docs/cli/mcp.md`
7. Add tests in `server_test.go`

> **Keep MCP tool names stable** — renaming breaks integrations.

## Adding a Memory Level

1. Update `MemoryLevel` enum in `internal/memory/types.go`
2. Update validation logic
3. Update `internal/storage/gob.go`
4. Update CLI commands
5. Add tests

## Updating the Embeddings Model

1. Update default in `internal/config/config.go`
2. Test: `CORTEX_EMBEDDINGS_MODEL=new-model cortex search "test"`
3. Update `docs/architecture/embeddings.md`
4. Check dimension changes — they affect storage compatibility

## Performance Notes

- **Embeddings**: prefer `EmbedBatch` over repeated `Embed` calls
- **Search**: in-memory index is fast; no tuning needed below ~10k memories
- **Storage**: Gob is efficient; consider SQLite above ~100k memories
- **Locks**: minimal critical sections; `RWMutex` for read-heavy paths

## Security Notes

- No sensitive data in logs
- Respect file permissions on storage files
- Validate all user input at the CLI layer
- MCP defaults to stdio (local); SSE should be localhost or behind auth
