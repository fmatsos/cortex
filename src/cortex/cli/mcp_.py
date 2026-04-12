"""cortex start-mcp-server — launch the MCP server."""

from __future__ import annotations

from typing import Annotated

import typer


def start_mcp_server(
    address: Annotated[
        str, typer.Option("--address", help="SSE server address (host:port)")
    ] = ":8080",
    transport: Annotated[
        str, typer.Option("--transport", help="Transport: stdio or sse")
    ] = "stdio",
) -> None:
    """Start the Cortex MCP server.

    Use --transport stdio (default) for Claude Code / Cursor integration.
    Use --transport sse for HTTP-based clients.
    """
    from cortex.mcp.server import run_server

    run_server(transport=transport, address=address)
