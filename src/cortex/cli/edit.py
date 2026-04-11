"""CLI command to edit an existing memory."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_embedder, get_storage, memory_to_dict, print_json
from cortex.memory.service import MemoryService


def edit_memory(
    memory_id: Annotated[str, typer.Argument(help="Memory ID or unique prefix")],
    title: Annotated[str, typer.Option("--title", "-t", help="New title")] = "",
    content: Annotated[str, typer.Option("--content", "-c", help="New content")] = "",
    tags: Annotated[str, typer.Option("--tags", help="New comma-separated tags")] = "",
    json_output: Annotated[bool, typer.Option("--json", "-j", help="Output as JSON")] = False,
) -> None:
    """Edit an existing memory's title, content, or tags."""
    if not title and not content and not tags:
        error("At least one of --title, --content, or --tags is required")

    storage = get_storage()
    try:
        embedder = get_embedder()
        svc = MemoryService(storage, embedder)
        memory = storage.get(memory_id)

        content_changed = False
        if title:
            memory.title = title
            content_changed = True
        if content:
            memory.content = content
            content_changed = True
        if tags:
            memory.tags = [t.strip() for t in tags.split(",") if t.strip()]
            content_changed = True

        updated = svc.update(memory, content_changed=content_changed)

        if json_output:
            print_json(memory_to_dict(updated))
        else:
            typer.echo(f"Updated memory {updated.id[:8]}")
    except KeyError:
        error(f"Memory not found: {memory_id}")
    finally:
        storage.close()
