# Cortex AI - Troubleshooting Guide

Solutions for common problems and issues.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Runtime Issues](#runtime-issues)
- [Configuration Issues](#configuration-issues)
- [Embedding Issues](#embedding-issues)
- [Storage Issues](#storage-issues)
- [MCP Server Issues](#mcp-server-issues)
- [Performance Issues](#performance-issues)
- [Data Issues](#data-issues)

---

## Installation Issues

### "cortex: command not found"

**Problem:** The cortex command is not found after installation.

**Solution 1: Add to PATH**

Check if the binary is installed:
```bash
# If installed with make install
echo $GOBIN
ls $GOBIN/cortex

# If not in PATH, add to shell profile
echo 'export PATH=$PATH:$(go env GOBIN)' >> ~/.bashrc
source ~/.bashrc
```

**Solution 2: Use absolute path**

```bash
$(go env GOBIN)/cortex --version
```

**Solution 3: Build locally**

```bash
make build
./bin/cortex --version
```

### Go version too old

**Problem:** "Error: go 1.24 required, but you have go X.Y"

**Solution:**

Update Go to version 1.24 or later:
```bash
# Visit https://golang.org/dl/
# Download and install latest version

go version  # Should show 1.24+
```

### Missing dependencies

**Problem:** "module not found" or compilation errors

**Solution:**

Download and update dependencies:
```bash
make deps
# or
go mod download
go mod tidy
```

---

## Runtime Issues

### "cortex: command not recognized"

**Problem:** Command is not valid.

**Solution:**

Check available commands:
```bash
cortex --help  # List all commands
cortex [command] --help  # Get help for specific command
```

### "Error: required flag not provided: --title"

**Problem:** Missing required flag.

**Solution:**

Provide all required flags:
```bash
# Missing --title
cortex create --type solution --content "..."

# Fixed
cortex create --title "Title" --type solution --content "..."
```

### Segmentation fault or crash

**Problem:** Application crashes unexpectedly.

**Solution 1: Check disk space**

```bash
df -h  # Check available space
```

**Solution 2: Check memory**

```bash
top  # Check available RAM
```

**Solution 3: Report bug**

Create an issue with:
- Exact command
- Error message
- Full output with `--log debug`

---

## Configuration Issues

### "Config file not found"

**Problem:** Configuration file doesn't exist.

**Solution:**

Create default config:
```bash
mkdir -p ~/.config/cortex-ai

# Copy default config
cortex config --show > ~/.config/cortex-ai/config.yaml
```

### "Invalid configuration: unknown field"

**Problem:** Config file has unrecognized field.

**Solution:**

Check config file for typos:
```bash
# Show current config
cortex config --show

# Edit to fix errors
cortex config --edit
```

Valid fields:
```yaml
storage:
  backend: gob
  path: ~/.local/share/cortex-ai

embeddings:
  provider: ollama
  endpoint: http://localhost:11434
  model: nomic-embed-text
  timeout: 30s

search:
  top_k: 5
  min_score: 0.5
  include_obsolete: false

output:
  format: text
  colors: true
```

### "Environment variable not recognized"

**Problem:** Setting env var has no effect.

**Solution:**

Use correct variable names (with `CORTEX_` prefix):
```bash
# Wrong
export STORAGE_PATH=...

# Correct
export CORTEX_STORAGE_PATH=...

# Check
cortex config --show  # Should show your values
```

---

## Embedding Issues

### "Connection refused" to Ollama

**Problem:** Cannot connect to Ollama service.

**Cause:** Ollama is not running.

**Solution:**

1. Start Ollama:
   ```bash
   ollama serve
   ```

2. Verify it's running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

3. Check endpoint configuration:
   ```yaml
   embeddings:
     endpoint: http://localhost:11434
   ```

### "Model not found: nomic-embed-text"

**Problem:** Embedding model is not available.

**Solution:**

Pull the model:
```bash
ollama pull nomic-embed-text

# Verify
ollama list  # Should show nomic-embed-text
```

### "Timeout waiting for embedding"

**Problem:** Embedding request takes too long and times out.

**Cause:** Model is slow or overloaded.

**Solution 1: Increase timeout**

```bash
# Via env var
export CORTEX_EMBEDDINGS_TIMEOUT=60s
cortex create ...

# Via config
embeddings:
  timeout: 60s
```

**Solution 2: Check Ollama status**

```bash
# Check system load
top

# Restart Ollama
killall ollama
ollama serve
```

**Solution 3: Use faster model**

```bash
ollama pull all-minilm-l6-v2

# Configure
embeddings:
  model: all-minilm-l6-v2
```

### Embeddings are slow

**Problem:** Creating/searching memories is very slow.

**Cause:** Model inference is slow.

**Solutions:**

1. **Check system resources:**
   ```bash
   top  # Check CPU/memory usage
   ```

2. **Use faster model:**
   ```bash
   ollama pull all-minilm-l6-v2
   # Update config to use all-minilm-l6-v2
   ```

3. **Enable GPU acceleration:**
   - Depends on your hardware
   - Check Ollama documentation

4. **Optimize text:**
   - Shorter titles are faster to embed
   - Trim unnecessary content

---

## Storage Issues

### "Permission denied" accessing storage

**Problem:** Cannot read/write to storage directory.

**Cause:** Incorrect file permissions.

**Solution:**

Fix permissions:
```bash
chmod 700 ~/.local/share/cortex-ai/
chmod 600 ~/.local/share/cortex-ai/*
```

### "Disk full" error

**Problem:** No space to save memories.

**Cause:** Disk is full.

**Solution:**

1. Check disk space:
   ```bash
   df -h
   ```

2. Free up space:
   - Delete old backups
   - Remove unused files
   - Clear temporary files

3. Move storage directory:
   ```bash
   # Backup
   cp -r ~/.local/share/cortex-ai/ /mnt/larger-disk/cortex-ai/

   # Update config
   storage:
     path: /mnt/larger-disk/cortex-ai
   ```

### "Corrupted memory file"

**Problem:** Error reading a specific memory.

**Cause:** File corruption (rare).

**Solution:**

1. **Backup first:**
   ```bash
   cp -r ~/.local/share/cortex-ai/ ~/backup-cortex-ai/
   ```

2. **Identify the file:**
   ```bash
   cortex get <id>  # If it fails, you have the ID
   ```

3. **Remove the corrupted file:**
   ```bash
   rm ~/.local/share/cortex-ai/memories/<id>.gob
   ```

4. **Restore from backup if needed:**
   ```bash
   cortex import exported-memories.md --force
   ```

### "Index corrupted" or "Index out of sync"

**Problem:** Vector index is corrupted.

**Solution:**

Rebuild the index:

1. Backup the directory:
   ```bash
   cp -r ~/.local/share/cortex-ai/ ~/backup/
   ```

2. Delete index file:
   ```bash
   rm ~/.local/share/cortex-ai/index.gob
   ```

3. Cortex will rebuild automatically on next operation

---

## MCP Server Issues

### "Failed to start MCP server"

**Problem:** MCP server won't start.

**Solution:**

1. Check port availability:
   ```bash
   # Default stdio (no port)
   cortex start-mcp-server

   # If using SSE, check port
   lsof -i :8080  # Check if 8080 is in use
   ```

2. Use different port:
   ```bash
   cortex start-mcp-server --transport sse --address :9000
   ```

3. Enable debug logging:
   ```bash
   cortex start-mcp-server --log debug
   ```

### MCP client cannot connect

**Problem:** Claude Code/Cursor cannot find the MCP server.

**Solution 1: Check MCP config**

**Claude Code** (~/.config/claude-code/mcp.json):
```json
{
  "mcpServers": {
    "cortex": {
      "command": "cortex",
      "args": ["start-mcp-server"]
    }
  }
}
```

**Solution 2: Verify cortex is installed**

```bash
which cortex  # Should show path
cortex --version  # Should work
```

**Solution 3: Check permissions**

Binary must be executable:
```bash
chmod +x $(which cortex)
```

---

## Performance Issues

### Search is slow

**Problem:** Semantic search takes a long time.

**Causes and solutions:**

1. **Large dataset:**
   - Normal for 10k+ memories
   - Consider implementing pagination
   - Consider SQLite backend (future)

2. **Slow embedding:**
   - See [Embedding Issues](#embedding-issues)

3. **Slow disk I/O:**
   - Check disk health
   - Move to faster drive

**Benchmark:**
```bash
# Typical performance on modern hardware
# With 1000 memories:
# - Search: 50-200ms
# - Create: 100-500ms
# - List: 100-300ms
```

### High memory usage

**Problem:** Cortex uses too much RAM.

**Cause:** Large vector index in memory.

**Solution:**

With 10k memories:
- Expected: ~100 MB
- With metadata: ~200 MB

If much higher:
- Check for memory leaks (file an issue)
- Reduce dataset size
- Use external storage (planned SQLite backend)

### Batch operations are slow

**Problem:** Importing or exporting many files is slow.

**Solution:**

1. **Process in batches:**
   ```bash
   # Import 100 at a time
   cortex import memories/batch1/*.md
   cortex import memories/batch2/*.md
   ```

2. **Use --dry-run to validate:**
   ```bash
   cortex import --dry-run *.md  # Fast validation
   ```

3. **Check system resources:**
   ```bash
   top  # Is Ollama CPU-bound?
   ```

---

## Data Issues

### Cannot find a memory

**Problem:** Memory should exist but search doesn't find it.

**Solutions:**

1. **List all memories:**
   ```bash
   cortex list  # Should show it
   ```

2. **Search with lower threshold:**
   ```bash
   cortex search "query" --min-score 0.1  # Default: 0.5
   ```

3. **Search with more results:**
   ```bash
   cortex search "query" --top 20  # Default: 5
   ```

4. **Check if obsolete:**
   ```bash
   cortex list --include-obsolete
   ```

### Duplicate memories

**Problem:** Same memory appears twice.

**Cause:** Imported with different IDs.

**Solution:**

1. **Identify duplicates:**
   ```bash
   cortex list  # Find similar titles
   ```

2. **Delete one:**
   ```bash
   cortex delete <duplicate-id>
   ```

3. **Prevent future:**
   - Use `cortex import --force` to overwrite
   - Include IDs in exported Markdown files

### Lost memories after update

**Problem:** Memories disappeared after update.

**Cause:** Usually a configuration change.

**Solution:**

1. **Check storage path:**
   ```bash
   cortex config --show | grep path
   ls ~/.local/share/cortex-ai/memories/
   ```

2. **Check if obsolete:**
   ```bash
   cortex list --include-obsolete
   ```

3. **Restore from backup:**
   ```bash
   cp -r ~/backup-cortex-ai/* ~/.local/share/cortex-ai/
   ```

---

## Getting Help

### Enable Debug Logging

```bash
# Show debug output
CORTEX_LOG_LEVEL=debug cortex search "query"

# Or via flag
cortex search "query" --log debug
```

### Get System Information

```bash
# Go version
go version

# Cortex version
cortex --version

# Ollama status
ollama list
ollama show nomic-embed-text

# Config
cortex config --show

# Storage info
ls -lh ~/.local/share/cortex-ai/
du -sh ~/.local/share/cortex-ai/
```

### Report a Bug

When reporting an issue:

1. **Describe the problem clearly**
2. **Provide exact command** that fails
3. **Show error message** (full output)
4. **Include system info:**
   ```bash
   go version
   cortex --version
   uname -a
   ```
5. **Enable debug logging:**
   ```bash
   cortex --log debug [command] 2>&1 > debug.log
   ```

Submit issue to: https://github.com/cortex-ai/cortex-ai/issues

---

## Related Documentation

- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration reference
- [EMBEDDINGS.md](./EMBEDDINGS.md) - Embeddings troubleshooting
- [STORAGE.md](./STORAGE.md) - Storage details
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development debugging
