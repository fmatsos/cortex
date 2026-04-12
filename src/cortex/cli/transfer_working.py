"""cortex transfer-working — promote session working memories to episodic."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_storage, print_json
from cortex.config.settings import get_settings
from cortex.session import derive_session_id


def transfer_working(
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
    session: Annotated[str, typer.Option("--session", help="Session ID to transfer")] = "",
) -> None:
    """Transfer all working memories for a session to episodic layer."""
    session_id = session
    if not session_id:
        settings = get_settings()
        try:
            session_id = derive_session_id(settings.session)
        except RuntimeError as exc:
            error(str(exc))

    storage = get_storage()
    try:
        count = storage.transfer_working_to_episodic(session_id)
    except Exception as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json({"session_id": session_id, "transferred": count})
        return

    if count:
        typer.echo(f"Transferred {count} working memories to episodic for session {session_id!r}")
    else:
        typer.echo(f"No working memories found for session {session_id!r}")
