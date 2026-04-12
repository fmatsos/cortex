"""cortex export — export memories to Markdown files."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from cortex.cli._common import error, get_storage
from cortex.markdown.export import export_memories, export_memory
from cortex.models.memory import MemoryLevel
from cortex.storage.base import ListOptions


def export_cmd(
    all_memories: Annotated[bool, typer.Option("--all", help="Export all memories")] = False,
    level: Annotated[str, typer.Option("--level", "-l", help="Filter by level")] = "",
    memory_id: Annotated[str, typer.Option("--id", help="Export a single memory by ID")] = "",
    output: Annotated[
        str | None, typer.Option("--output", "-o", help="Output file path (stdout if omitted)")
    ] = None,
) -> None:
    """Export memories to Markdown format."""
    if memory_id and (level or all_memories):
        error("--id cannot be combined with --level or --all")
    if level and all_memories:
        error("--level cannot be combined with --all")

    storage = get_storage()

    try:
        if memory_id:
            memory = storage.get(memory_id)
            text = export_memory(memory)
        else:
            filter_level: MemoryLevel | None = None
            if level:
                try:
                    filter_level = MemoryLevel(level)
                except ValueError:
                    error(f"Invalid level {level!r}")

            opts = ListOptions(level=filter_level, include_obsolete=False)
            memories = storage.list(opts)
            if not memories:
                typer.echo("No memories to export.", err=True)
                raise typer.Exit(0)
            text = export_memories(memories)
    except (KeyError, ValueError) as exc:
        error(str(exc))
    finally:
        storage.close()

    if output:
        Path(output).write_text(text, encoding="utf-8")
        typer.echo(f"Exported to {output}")
    else:
        typer.echo(text, nl=False)
