"""Cortex CLI root application."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli import (
    autoprune,
    config_,
    consolidate,
    create,
    delete,
    export_,
    get,
    import_,
    list_,
    mcp_,
    search,
    session_,
    stats,
    transfer_working,
)
from cortex.config.settings import load_settings

app = typer.Typer(
    name="cortex",
    help="Three-layer semantic memory system for AI assistants.",
    no_args_is_help=True,
    pretty_exceptions_enable=False,
)

# Register subcommands
app.command("create")(create.create)
app.command("search")(search.search)
app.command("list")(list_.list_memories)
app.command("get")(get.get_memory)
app.command("delete")(delete.delete_memory)
app.command("consolidate")(consolidate.consolidate)
app.command("transfer-working")(transfer_working.transfer_working)
app.command("autoprune")(autoprune.autoprune)
app.command("export")(export_.export_cmd)
app.command("import")(import_.import_cmd)
app.command("stats")(stats.stats_cmd)
app.command("config")(config_.config_cmd)
app.command("start-mcp-server")(mcp_.start_mcp_server)
app.command("session")(session_.session_cmd)


@app.callback()
def main_callback(
    ctx: typer.Context,
    config: Annotated[
        str | None,
        typer.Option("--config", help="Path to config file"),
    ] = None,
    log_level: Annotated[
        str,
        typer.Option("--log-level", help="Log level: debug, info, warning, error"),
    ] = "info",
) -> None:
    """Cortex — three-layer semantic memory system."""
    if config:
        load_settings(config_path=config)
