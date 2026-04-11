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


def memory_to_dict(memory: Any, *, compact: bool = False) -> dict[str, Any]:
    """Serialize a Memory to a JSON-compatible dict.

    Args:
        memory: Memory object to serialize.
        compact: If True, return minimal fields for token efficiency.
    """
    from cortex.models.memory import Memory

    m: Memory = memory
    level_val = m.level if isinstance(m.level, str) else m.level.value

    if compact:
        return {
            "id": m.id[:8],
            "level": level_val,
            "title": m.title,
            "tags": m.tags,
            "updated_at": m.updated_at.isoformat()[:10],
        }

    # Build context dict, stripping empty-string values
    source_val = m.context.source if isinstance(m.context.source, str) else m.context.source.value
    ctx_raw = {
        "session_id": m.context.session_id,
        "task_id": m.context.task_id,
        "author": m.context.author,
        "source": source_val,
        "related_memories": m.context.related_memories,
        "git_branch": m.context.git_branch,
        "agent_name": m.context.agent_name,
        "agent_session_id": m.context.agent_session_id,
        "user_prompt": m.context.user_prompt,
    }
    ctx = {k: v for k, v in ctx_raw.items() if v != "" and v != []}

    return {
        "id": m.id,
        "level": level_val,
        "title": m.title,
        "content": m.content,
        "tags": m.tags,
        "context": ctx,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "merged_from": m.merged_from,
        "obsolete": m.obsolete,
    }
