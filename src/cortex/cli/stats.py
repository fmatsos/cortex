"""cortex stats — display database statistics."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import get_storage, print_json


def stats_cmd(
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Display memory database statistics."""
    storage = get_storage()
    counts = storage.stats()
    storage.close()

    total = sum(counts.values())

    if as_json:
        print_json({**counts, "total": total})
        return

    typer.echo("Memory Statistics:")
    typer.echo(f"  Working:  {counts.get('working', 0)}")
    typer.echo(f"  Episodic: {counts.get('episodic', 0)}")
    typer.echo(f"  Semantic: {counts.get('semantic', 0)}")
    typer.echo("  ─────────────────")
    typer.echo(f"  Total:    {total}")
