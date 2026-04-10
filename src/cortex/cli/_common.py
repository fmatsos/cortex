"""Shared CLI utilities: storage, embedder initialization and output formatting."""

from __future__ import annotations

import json
from typing import Any

import typer

from cortex.config.settings import get_settings
from cortex.embeddings.ollama import OllamaEmbedder
from cortex.storage.chroma import ChromaStorage


def get_storage() -> ChromaStorage:
    """Initialize and return the ChromaDB storage backend."""
    settings = get_settings()
    return ChromaStorage(path=settings.storage.path)


def get_embedder() -> OllamaEmbedder:
    """Initialize and return the Ollama embedder."""
    settings = get_settings()
    return OllamaEmbedder(config=settings.embeddings)


def print_json(data: Any) -> None:
    """Print data as pretty-printed JSON to stdout."""
    typer.echo(json.dumps(data, indent=2, default=str))


def error(message: str, exit_code: int = 1) -> None:
    """Print an error message to stderr and exit."""
    typer.echo(f"Error: {message}", err=True)
    raise typer.Exit(exit_code)


def memory_to_dict(memory: Any) -> dict[str, Any]:
    """Serialize a Memory to a JSON-compatible dict."""
    from cortex.models.memory import Memory

    m: Memory = memory
    return {
        "id": m.id,
        "level": m.level if isinstance(m.level, str) else m.level.value,
        "title": m.title,
        "content": m.content,
        "tags": m.tags,
        "context": {
            "session_id": m.context.session_id,
            "task_id": m.context.task_id,
            "author": m.context.author,
            "source": m.context.source
            if isinstance(m.context.source, str)
            else m.context.source.value,
            "related_memories": m.context.related_memories,
        },
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "merged_from": m.merged_from,
        "obsolete": m.obsolete,
    }
