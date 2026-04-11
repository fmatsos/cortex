"""cortex stats — display database statistics."""

from __future__ import annotations

from collections import Counter
from typing import Annotated

import typer

from cortex.cli._common import get_storage, print_json
from cortex.models.memory import MemoryLevel
from cortex.storage.base import ListOptions


def stats_cmd(
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Display memory database statistics."""
    storage = get_storage()
    try:
        counts = storage.stats()
        total = sum(counts.values())

        # Gather extended metrics
        all_memories = storage.list(ListOptions(include_obsolete=True))
        obsolete_count = sum(1 for m in all_memories if m.obsolete)
        tag_counter: Counter[str] = Counter()
        for m in all_memories:
            tag_counter.update(m.tags)
        top_tags = tag_counter.most_common(10)

        # Find oldest/newest per level
        level_ages: dict[str, dict[str, str]] = {}
        for level in [MemoryLevel.working, MemoryLevel.episodic, MemoryLevel.semantic]:
            mems = [m for m in all_memories if m.level == level]
            if mems:
                oldest = min(mems, key=lambda m: m.created_at)
                newest = max(mems, key=lambda m: m.created_at)
                level_ages[level.value] = {
                    "oldest": oldest.created_at.isoformat()[:10],
                    "newest": newest.created_at.isoformat()[:10],
                }

        if as_json:
            print_json(
                {
                    **counts,
                    "total": total,
                    "obsolete": obsolete_count,
                    "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
                    "level_ages": level_ages,
                }
            )
            return

        typer.echo("Memory Statistics:")
        typer.echo(f"  Working:  {counts.get('working', 0)}")
        typer.echo(f"  Episodic: {counts.get('episodic', 0)}")
        typer.echo(f"  Semantic: {counts.get('semantic', 0)}")
        typer.echo("  ─────────────────")
        typer.echo(f"  Total:    {total}")
        typer.echo(f"  Obsolete: {obsolete_count}")
        if top_tags:
            typer.echo("\nTop Tags:")
            for tag, count in top_tags:
                typer.echo(f"  {tag}: {count}")
        for lv, ages in level_ages.items():
            typer.echo(f"\n{lv.capitalize()}:")
            typer.echo(f"  Oldest: {ages['oldest']}")
            typer.echo(f"  Newest: {ages['newest']}")
    finally:
        storage.close()
