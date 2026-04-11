"""cortex create — create a new memory."""

from __future__ import annotations

from typing import Annotated

import typer

from cortex.cli._common import error, get_embedder, get_storage, memory_to_dict, print_json
from cortex.config.settings import get_settings
from cortex.memory.service import CreateInput, MemoryService
from cortex.models.memory import MemoryLevel, MemorySource
from cortex.session import derive_session_id


def create(
    title: Annotated[str | None, typer.Option("--title", "-t", help="Memory title")] = None,
    content: Annotated[str | None, typer.Option("--content", "-c", help="Memory content")] = None,
    level: Annotated[
        str, typer.Option("--level", "-l", help="Memory level: working, episodic, semantic")
    ] = "episodic",
    tags: Annotated[str, typer.Option("--tags", help="Comma-separated tags")] = "",
    session: Annotated[
        str, typer.Option("--session", help="Session ID (required for working level)")
    ] = "",
    source: Annotated[str, typer.Option("--source", help="Source: manual, auto, llm")] = "manual",
    task_id: Annotated[str, typer.Option("--task-id", help="Task/ticket ID")] = "",
    author: Annotated[str, typer.Option("--author", help="Author identifier")] = "",
    git_branch: Annotated[
        str, typer.Option("--git-branch", help="Git branch (auto-detected if omitted)")
    ] = "",
    agent_name: Annotated[str, typer.Option("--agent-name", help="AI agent name")] = "",
    agent_session: Annotated[str, typer.Option("--agent-session", help="AI agent session ID")] = "",
    user_prompt: Annotated[str, typer.Option("--user-prompt", help="Triggering user prompt")] = "",
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Create a new memory."""
    # Validate level
    try:
        mem_level = MemoryLevel(level)
    except ValueError:
        error(f"Invalid level {level!r}. Must be: working, episodic, semantic")

    # Validate source
    try:
        mem_source = MemorySource(source)
    except ValueError:
        error(f"Invalid source {source!r}. Must be: manual, auto, llm")

    # Require content
    if not content:
        error("--content is required")

    # Derive title if not provided
    final_title = title or content[:60].strip()  # type: ignore[union-attr]

    # Auto-derive session for working level
    session_id = session
    if mem_level == MemoryLevel.working and not session_id:
        settings = get_settings()
        try:
            session_id = derive_session_id(settings.session)
        except RuntimeError as exc:
            error(str(exc))

    # Parse tags
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    storage = get_storage()
    embedder = get_embedder()
    svc = MemoryService(storage, embedder)

    try:
        memory = svc.create(
            CreateInput(
                title=final_title,
                content=content,  # type: ignore[arg-type]
                level=mem_level,
                tags=tag_list,
                session_id=session_id,
                source=mem_source,
                task_id=task_id,
                author=author,
                git_branch=git_branch,
                agent_name=agent_name,
                agent_session_id=agent_session,
                user_prompt=user_prompt,
            )
        )
    except ValueError as exc:
        error(str(exc))
    finally:
        storage.close()

    if as_json:
        print_json(memory_to_dict(memory))
    else:
        typer.echo(f"Created memory: {memory.id}")
        typer.echo(f"  Level: {memory.level}")
        typer.echo(f"  Title: {memory.title}")
        if memory.tags:
            typer.echo(f"  Tags:  {', '.join(memory.tags)}")
