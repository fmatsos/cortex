"""cortex config — view or initialize configuration."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import print_json
from cortex.config.settings import get_settings


def config_cmd(
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Show the current Cortex configuration."""
    settings = get_settings()

    if as_json:
        print_json(settings.model_dump())
        return

    typer.echo("Cortex Configuration:")
    typer.echo("")

    data = settings.model_dump()
    for section, values in data.items():
        typer.echo(f"[{section}]")
        if isinstance(values, dict):
            for k, v in values.items():
                typer.echo(f"  {k}: {v}")
        else:
            typer.echo(f"  {values}")
        typer.echo("")
