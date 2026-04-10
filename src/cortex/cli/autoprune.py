"""cortex autoprune — clean up and optimize the memory database."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_storage, print_json
from cortex.config.settings import get_settings
from cortex.consolidation.autoprune import AutopruneService


def autoprune(
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Show what would be done without making changes")
    ] = False,
    duplicates: Annotated[
        bool, typer.Option("--duplicates", help="Remove duplicate memories")
    ] = False,
    episodic: Annotated[
        bool, typer.Option("--episodic", help="Archive old episodic memories")
    ] = False,
    semantic: Annotated[
        bool, typer.Option("--semantic", help="Merge similar semantic memories")
    ] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Clean up and optimize the memory database.

    Runs all three operations by default (duplicates, episodic archiving, semantic merging).
    Use --duplicates/--episodic/--semantic to run specific operations only.
    """
    settings = get_settings()
    storage = get_storage()

    svc = AutopruneService(
        storage=storage,
        duplicates_threshold=settings.autoprune.duplicates_threshold,
        episodic_retention_days=settings.autoprune.episodic_retention_days,
        semantic_merge_threshold=settings.autoprune.semantic_merge_threshold,
    )

    # If specific ops are requested, run only those
    run_all = not (duplicates or episodic or semantic)

    try:
        from cortex.models.results import AutopruneResult

        result = AutopruneResult(dry_run=dry_run)

        if run_all or duplicates:
            result.duplicates = svc._remove_duplicates(dry_run)
        if run_all or episodic:
            result.episodic = svc._archive_episodic(dry_run)
        if run_all or semantic:
            result.semantic = svc._merge_semantic(dry_run)
    except Exception as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json(result.model_dump())
        return

    prefix = "[dry-run] " if dry_run else ""
    typer.echo(f"{prefix}{result.summary()}")
    for detail in result.duplicates.details + result.episodic.details + result.semantic.details:
        typer.echo(f"  {detail}")
