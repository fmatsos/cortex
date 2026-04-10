"""cortex import -- import memories from Markdown files."""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Annotated

import typer

from cortex.cli._common import error, get_embedder, get_storage, print_json
from cortex.markdown.import_ import ImportError, import_file
from cortex.memory.service import MemoryService


def import_cmd(
    paths: Annotated[list[Path], typer.Argument(help="Markdown files to import")],
    force: Annotated[
        bool, typer.Option("--force", help="Overwrite existing memories with same ID")
    ] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Validate without saving")] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Import memories from Markdown files."""
    if not paths:
        error("Provide at least one Markdown file path")

    results = []
    storage = get_storage()
    embedder = get_embedder()

    for path in paths:
        try:
            memory = import_file(path)
        except ImportError as exc:
            results.append({"file": str(path), "status": "error", "error": str(exc)})
            continue

        if dry_run:
            results.append(
                {"file": str(path), "status": "valid", "id": memory.id, "title": memory.title}
            )
            continue

        try:
            embed_text = MemoryService.EMBED_TEXT_TEMPLATE.format(
                title=memory.title,
                content=memory.content,
                tags=", ".join(memory.tags),
            )
            memory.embedding = embedder.embed(embed_text)

            if force:
                with contextlib.suppress(KeyError):
                    storage.delete(memory.id)
            storage.save(memory)
            results.append({"file": str(path), "status": "imported", "id": memory.id})
        except Exception as exc:
            results.append({"file": str(path), "status": "error", "error": str(exc)})

    storage.close()

    if as_json:
        print_json(results)
        return

    for r in results:
        status = r["status"]
        file_name = Path(r["file"]).name
        if status == "error":
            typer.echo(f"  ERROR  {file_name}: {r['error']}", err=True)
        elif status == "valid":
            typer.echo(f"  VALID  {file_name}: {r.get('title', '')}")
        else:
            typer.echo(f"  OK     {file_name}: {r.get('id', '')[:8]}")
