"""cortex list — list memories with filtering."""

from __future__ import annotations

from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from cortex.cli._common import error, get_storage, memory_to_dict, print_json
from cortex.models.memory import MemoryLevel
from cortex.storage.base import ListOptions

console = Console()


def list_memories(
    level: Annotated[
        str, typer.Option("--level", "-l", help="Filter by level: working, episodic, semantic")
    ] = "",
    session: Annotated[str, typer.Option("--session", help="Filter by session ID")] = "",
    include_obsolete: Annotated[
        bool, typer.Option("--include-obsolete", help="Include obsolete memories")
    ] = False,
    limit: Annotated[int, typer.Option("--limit", help="Maximum number of results (0 = all)")] = 0,
    offset: Annotated[int, typer.Option("--offset", help="Number of results to skip")] = 0,
    reverse: Annotated[
        bool, typer.Option("--reverse", help="Reverse sort order (oldest first)")
    ] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """List memories with optional filtering."""
    filter_level: MemoryLevel | None = None
    if level:
        try:
            filter_level = MemoryLevel(level)
        except ValueError:
            error(f"Invalid level {level!r}. Must be: working, episodic, semantic")

    storage = get_storage()

    opts = ListOptions(
        level=filter_level,
        session_id=session,
        include_obsolete=include_obsolete,
        limit=limit,
        offset=offset,
        reverse=reverse,
    )

    try:
        memories = storage.list(opts)
    except Exception as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json([memory_to_dict(m) for m in memories])
        return

    if not memories:
        typer.echo("No memories found.")
        return

    table = Table(title="Memories", show_lines=True)
    table.add_column("ID", style="dim", width=10)
    table.add_column("Level", width=8)
    table.add_column("Title", style="bold")
    table.add_column("Tags")
    table.add_column("Updated", width=12)

    for m in memories:
        level_val = m.level if isinstance(m.level, str) else m.level.value
        table.add_row(
            m.id[:8],
            level_val,
            m.title,
            ", ".join(m.tags) if m.tags else "",
            m.updated_at.strftime("%Y-%m-%d"),
        )

    console.print(table)
    typer.echo(f"\nTotal: {len(memories)}")
