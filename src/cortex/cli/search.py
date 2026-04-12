"""cortex search — semantic search across memory layers."""

from __future__ import annotations

from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from cortex.cli._common import error, get_embedder, get_storage, memory_to_dict, print_json
from cortex.config.settings import get_settings
from cortex.memory.service import MemoryService
from cortex.models.memory import MemoryLevel
from cortex.storage.base import SearchOptions

console = Console()


def search(
    query: Annotated[str, typer.Argument(help="Search query")],
    top: Annotated[int, typer.Option("--top", "-n", help="Maximum results")] = 5,
    min_score: Annotated[float, typer.Option("--min-score", help="Minimum similarity score")] = 0.5,
    level: Annotated[str, typer.Option("--level", help="Filter by level(s), comma-separated")] = "",
    session: Annotated[
        str, typer.Option("--session", help="Filter by session ID (working memories)")
    ] = "",
    include_obsolete: Annotated[
        bool, typer.Option("--include-obsolete", help="Include obsolete memories")
    ] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Search memories using semantic similarity."""
    settings = get_settings()

    # Resolve defaults from settings
    effective_top = top if top != 5 else settings.search.top_k
    effective_score = min_score if min_score != 0.5 else settings.search.min_score

    # Parse level filter
    filter_levels: list[MemoryLevel] | None = None
    if level:
        try:
            filter_levels = [MemoryLevel(lv.strip()) for lv in level.split(",") if lv.strip()]
        except ValueError as exc:
            error(str(exc))

    storage = get_storage()
    embedder = get_embedder()
    svc = MemoryService(storage, embedder)

    opts = SearchOptions(
        top_k=effective_top,
        min_score=effective_score,
        filter_levels=filter_levels,
        include_obsolete=include_obsolete,
        session_id=session,
    )

    try:
        results = svc.search(query, opts)
    except Exception as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json([{"score": round(r.score, 4), **memory_to_dict(r.memory)} for r in results])
        return

    if not results:
        typer.echo("No results found.")
        return

    table = Table(title=f"Search: {query!r}", show_lines=True)
    table.add_column("Score", style="green", width=6)
    table.add_column("ID", style="dim", width=10)
    table.add_column("Title", style="bold")
    table.add_column("Level", width=8)
    table.add_column("Tags")

    for r in results:
        m = r.memory
        level_val = str(m.level)
        table.add_row(
            f"{r.score:.3f}",
            m.id[:8],
            m.title,
            level_val,
            ", ".join(m.tags) if m.tags else "",
        )

    console.print(table)
