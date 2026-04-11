"""cortex consolidate — create or merge memories with deduplication."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_embedder, get_storage, print_json
from cortex.config.settings import get_settings
from cortex.consolidation.service import ConsolidateInput, ConsolidationService
from cortex.models.memory import MemoryLevel, MemorySource
from cortex.session import derive_session_id


def consolidate(
    synthesis: Annotated[str, typer.Argument(help="Content to consolidate")],
    level: Annotated[str, typer.Option("--level", "-l", help="Memory level")] = "semantic",
    title: Annotated[
        str, typer.Option("--title", "-t", help="Memory title (derived from content if omitted)")
    ] = "",
    tags: Annotated[str, typer.Option("--tags", help="Comma-separated tags")] = "",
    session: Annotated[str, typer.Option("--session", help="Session ID")] = "",
    source: Annotated[str, typer.Option("--source", help="Source: manual, auto, llm")] = "manual",
    task_id: Annotated[str, typer.Option("--task-id", help="Task/ticket ID")] = "",
    author: Annotated[str, typer.Option("--author", help="Author identifier")] = "",
    git_branch: Annotated[
        str, typer.Option("--git-branch", help="Git branch (auto-detected if omitted)")
    ] = "",
    agent_name: Annotated[str, typer.Option("--agent-name", help="Agent name")] = "",
    agent_session: Annotated[str, typer.Option("--agent-session", help="Agent session ID")] = "",
    user_prompt: Annotated[
        str, typer.Option("--user-prompt", help="User prompt that triggered this memory")
    ] = "",
    force: Annotated[bool, typer.Option("--force", help="Skip duplicate detection")] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Create a memory or merge with a similar existing one."""
    try:
        mem_level = MemoryLevel(level)
    except ValueError:
        error(f"Invalid level {level!r}. Must be: working, episodic, semantic")

    try:
        mem_source = MemorySource(source)
    except ValueError:
        error(f"Invalid source {source!r}. Must be: manual, auto, llm")

    session_id = session
    if mem_level == MemoryLevel.working and not session_id:
        settings = get_settings()
        try:
            session_id = derive_session_id(settings.session)
        except RuntimeError as exc:
            error(str(exc))

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    settings = get_settings()

    storage = get_storage()
    embedder = get_embedder()
    svc = ConsolidationService(
        storage=storage,
        embedder=embedder,
        similarity_threshold=settings.consolidation.similarity_threshold,
    )

    try:
        result = svc.consolidate(
            ConsolidateInput(
                synthesis=synthesis,
                level=mem_level,
                title=title,
                tags=tag_list,
                session_id=session_id,
                source=mem_source,
                task_id=task_id,
                author=author,
                git_branch=git_branch,
                agent_name=agent_name,
                agent_session_id=agent_session,
                user_prompt=user_prompt,
                force=force,
            )
        )
    except Exception as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json(result.model_dump())
        return

    typer.echo(f"Action:    {result.action}")
    typer.echo(f"Memory ID: {result.memory_id}")
    typer.echo(f"Level:     {result.level}")
    if result.similarity:
        typer.echo(f"Similarity: {result.similarity:.3f}")
    typer.echo(f"Message:   {result.message}")
