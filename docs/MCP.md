# Cortex AI - MCP Integration

This document describes how to integrate Cortex AI with MCP-compatible tools like Claude Code and Cursor.

## Overview

Cortex AI provides an MCP (Model Context Protocol) server that exposes memory operations as tools. This allows AI assistants to:

- Search for relevant memories semantically
- Create new memories to store solutions, issues, and analyses
- List and retrieve existing memories

## Installation

Build and install Cortex AI:

```bash
make build
# or
make install
```

The MCP server is available as a subcommand: `cortex start-mcp-server`

## Transport Modes

The MCP server supports two transport modes:

| Transport | Description | Use Case |
|-----------|-------------|----------|
| `stdio` | Communication via stdin/stdout | CLI integrations (default) |
| `sse` | Server-Sent Events over HTTP | Web integrations, remote access |

### Stdio Transport (Default)

The stdio transport communicates via standard input/output streams. This is the default mode used by CLI tools like Claude Code and Cursor.

```bash
cortex start-mcp-server
# or explicitly:
cortex start-mcp-server --transport stdio
```

### SSE Transport

The SSE (Server-Sent Events) transport runs an HTTP server for web-based integrations.

```bash
cortex start-mcp-server --transport sse --address :8080
```

**Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | SSE event stream for server messages |
| `/message?session_id=<id>` | POST | Send JSON-RPC requests to the server |
| `/health` | GET | Health check endpoint |

**Connection Flow:**

1. Client connects to `GET /sse` to establish the event stream
2. Server sends an `endpoint` event with the message URL including session ID
3. Client sends requests via `POST /message?session_id=<id>`
4. Server sends responses as `message` events on the SSE stream

**Example SSE Client (JavaScript):**

```javascript
const eventSource = new EventSource('http://localhost:8080/sse');
let messageEndpoint = '';

eventSource.addEventListener('endpoint', (e) => {
  messageEndpoint = e.data;
  console.log('Message endpoint:', messageEndpoint);
});

eventSource.addEventListener('message', (e) => {
  const response = JSON.parse(e.data);
  console.log('Response:', response);
});

// Send a request
async function sendRequest(method, params) {
  const response = await fetch(messageEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params
    })
  });
  return response.json();
}
```

## CLI Configuration

### Claude Code

Add the following to your Claude Code MCP configuration (`~/.config/claude-code/mcp.json`):

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

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcp": {
    "servers": {
      "cortex": {
        "command": "cortex",
        "args": ["start-mcp-server"]
      }
    }
  }
}
```

## Command-Line Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--transport` | `stdio` | Transport mode: `stdio` or `sse` |
| `--address` | `:8080` | Address for SSE transport (e.g., `:8080` or `127.0.0.1:8080`) |

## Available Tools

### cortex_search

Search memories using semantic similarity.

**Parameters:**
- `query` (required): The search query
- `top_k` (optional): Maximum results (default: 5)
- `min_score` (optional): Minimum similarity score 0-1 (default: 0.5)
- `type` (optional): Filter by type (solution|issue|analysis|rule|any)

**Example:**
```json
{
  "name": "cortex_search",
  "arguments": {
    "query": "authentication error handling",
    "top_k": 3,
    "type": "solution"
  }
}
```

### cortex_create

Create a new memory.

**Parameters:**
- `title` (required): Memory title
- `content` (required): Memory content (Markdown supported)
- `type` (required): Memory type (solution|issue|analysis|rule|any)
- `tags` (optional): Array of tags for categorization

**Example:**
```json
{
  "name": "cortex_create",
  "arguments": {
    "title": "JWT Token Refresh Pattern",
    "content": "## Problem\nTokens expire...\n\n## Solution\nImplement refresh...",
    "type": "solution",
    "tags": ["authentication", "jwt", "security"]
  }
}
```

### cortex_list

List all memories.

**Parameters:**
- `type` (optional): Filter by type
- `include_obsolete` (optional): Include obsolete memories (default: false)

**Example:**
```json
{
  "name": "cortex_list",
  "arguments": {
    "type": "issue"
  }
}
```

### cortex_get

Get a specific memory by ID.

**Parameters:**
- `id` (required): The memory ID

**Example:**
```json
{
  "name": "cortex_get",
  "arguments": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

## Environment Variables

- `CORTEX_STORAGE_PATH`: Path to the storage directory (default: `~/.local/share/cortex-ai`)
- `CORTEX_EMBEDDINGS_ENDPOINT`: Ollama endpoint (default: `http://localhost:11434`)
- `CORTEX_EMBEDDINGS_MODEL`: Embedding model (default: `nomic-embed-text`)

## Protocol

The MCP server communicates using JSON-RPC 2.0 over the selected transport (stdio or SSE). It implements the MCP specification version `2024-11-05`.

### Supported Methods

- `initialize`: Initialize the server connection
- `initialized`: Notification that client is ready
- `tools/list`: List available tools
- `tools/call`: Invoke a tool
- `shutdown`: Gracefully shutdown the server

## Troubleshooting

### Ollama Connection

Ensure Ollama is running:

```bash
ollama serve
```

And the embedding model is available:

```bash
ollama pull nomic-embed-text
```

### Storage Permissions

Ensure the storage directory exists and is writable:

```bash
mkdir -p ~/.local/share/cortex-ai
```

### Debug Logging

The MCP server logs to stderr. To capture logs:

```bash
cortex start-mcp-server 2>mcp.log
```
