"""cortex delete — permanently delete a memory."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_storage


def delete_memory(
    memory_id: Annotated[str, typer.Argument(help="Memory ID or unique prefix")],
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt")] = False,
) -> None:
    """Permanently delete a memory."""
    storage = get_storage()

    # Resolve the ID first to show details before confirmation
    try:
        memory = storage.get(memory_id)
    except KeyError:
        storage.close()
        error(f"Memory not found: {memory_id!r}")
    except ValueError as exc:
        storage.close()
        error(str(exc))

    if not yes:
        typer.echo(f"Memory: {memory.id}")
        typer.echo(f"Title:  {memory.title}")
        typer.echo(f"Level:  {memory.level}")
        confirmed = typer.confirm("Permanently delete this memory?")
        if not confirmed:
            storage.close()
            typer.echo("Cancelled.")
            raise typer.Exit(0)

    try:
        storage.delete(memory.id)
    except KeyError:
        error(f"Memory not found: {memory_id!r}")
    finally:
        storage.close()

    typer.echo(f"Deleted: {memory.id}")
