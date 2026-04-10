"""cortex get — retrieve a single memory by ID."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_storage, memory_to_dict, print_json


def get_memory(
    memory_id: Annotated[str, typer.Argument(help="Memory ID or unique prefix")],
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Retrieve a memory by ID or unique ID prefix."""
    storage = get_storage()
    try:
        memory = storage.get(memory_id)
    except KeyError:
        error(f"Memory not found: {memory_id!r}")
    except ValueError as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json(memory_to_dict(memory))
        return

    level_val = memory.level if isinstance(memory.level, str) else memory.level.value
    typer.echo(f"ID:      {memory.id}")
    typer.echo(f"Level:   {level_val}")
    typer.echo(f"Title:   {memory.title}")
    typer.echo(f"Tags:    {', '.join(memory.tags) or '(none)'}")
    typer.echo(f"Created: {memory.created_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    typer.echo(f"Updated: {memory.updated_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    if memory.context.session_id:
        typer.echo(f"Session: {memory.context.session_id}")
    if memory.obsolete:
        typer.echo("Status:  OBSOLETE")
    typer.echo("")
    typer.echo(memory.content)
