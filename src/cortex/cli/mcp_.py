"""cortex start-mcp-server — launch the MCP server."""

from __future__ import annotations

import logging
from typing import Annotated

import typer


def start_mcp_server(
    address: Annotated[
        str, typer.Option("--address", help="SSE server address (host:port)")
    ] = ":8080",
    transport: Annotated[
        str, typer.Option("--transport", help="Transport: stdio or sse")
    ] = "stdio",
    v: Annotated[bool, typer.Option("-v", "--v", help="Verbose: server lifecycle (INFO)")] = False,
    vv: Annotated[
        bool, typer.Option("-vv", "--vv", help="Very verbose: tool calls (DEBUG)")
    ] = False,
    vvv: Annotated[
        bool, typer.Option("-vvv", "--vvv", help="Trace: full request details (DEBUG)")
    ] = False,
) -> None:
    """Start the Cortex MCP server.

    Use --transport stdio (default) for Claude Code / Cursor integration.
    Use --transport sse for HTTP-based clients.

    Verbosity levels:
    -v    : Server lifecycle (startup, ready)
    -vv   : Tool invocations (method names)
    -vvv  : Full debugging (arguments and payloads)
    """
    from cortex.mcp.server import run_server

    verbose_level = 3 if vvv else 2 if vv else 1 if v else 0
    if verbose_level >= 2:
        logging.getLogger().setLevel(logging.DEBUG)
    elif verbose_level == 1:
        logging.getLogger().setLevel(logging.INFO)

    run_server(transport=transport, address=address, verbose_level=verbose_level)
