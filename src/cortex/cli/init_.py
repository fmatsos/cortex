"""Initialize Cortex configuration files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from cortex.config.settings import (
    Settings,
    default_global_config_path,
    default_local_config_path,
)


def init_cmd(
    global_install: Annotated[
        bool,
        typer.Option(
            "--global/--local",
            help="Write config to the global user config directory or the current project.",
        ),
    ] = True,
) -> None:
    """Create a default config file if one does not already exist."""
    target: Path = default_global_config_path() if global_install else default_local_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        typer.echo(f"Config already exists at {target}")
        return

    defaults = Settings().model_dump()
    with target.open("w", encoding="utf-8") as f:
        json.dump(defaults, f, indent=2)
        f.write("\n")

    typer.echo(f"Created config at {target}")
