"""cortex session — display the derived session ID."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, print_json
from cortex.config.settings import get_settings
from cortex.session import derive_session_id


def session_cmd(
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Display the current session ID (derived from git branch)."""
    settings = get_settings()
    try:
        session_id = derive_session_id(settings.session)
    except RuntimeError as exc:
        error(str(exc))

    if as_json:
        print_json({"session_id": session_id})
        return

    typer.echo(session_id)
