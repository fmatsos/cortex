"""Cortex MCP server — exposes 13 tools for Claude Code integration."""

from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from cortex.cli._common import get_embedder, get_storage, memory_to_dict
from cortex.config.settings import get_settings
from cortex.consolidation.service import ConsolidateInput, ConsolidationService
from cortex.memory.service import CreateInput, MemoryService
from cortex.models.memory import MemoryLevel, MemorySource
from cortex.session import derive_session_id
from cortex.storage.base import ListOptions, SearchOptions

mcp = FastMCP("cortex")


def _get_svc() -> tuple[MemoryService, Any]:
    """Build MemoryService and return (service, storage) for cleanup."""
    storage = get_storage()
    embedder = get_embedder()
    return MemoryService(storage, embedder), storage


# ------------------------------------------------------------------
# Core memory tools
# ------------------------------------------------------------------


@mcp.tool()
def cortex_search(
    query: str,
    top_k: int = 5,
    min_score: float = 0.5,
    level: str = "",
    session_id: str = "",
    include_obsolete: bool = False,
) -> list[dict[str, Any]]:
    """Search memories using semantic similarity.

    Args:
        query: The search query string.
        top_k: Maximum number of results to return.
        min_score: Minimum similarity score threshold (0.0-1.0).
        level: Filter by memory level (working/episodic/semantic). Empty = all.
        session_id: Filter working memories by session ID.
        include_obsolete: Include obsolete (soft-deleted) memories.

    Returns:
        List of memories with similarity scores.
    """
    filter_levels: list[MemoryLevel] | None = None
    if level:
        filter_levels = [MemoryLevel(lv.strip()) for lv in level.split(",") if lv.strip()]

    svc, storage = _get_svc()
    try:
        opts = SearchOptions(
            top_k=top_k,
            min_score=min_score,
            filter_levels=filter_levels,
            include_obsolete=include_obsolete,
            session_id=session_id,
        )
        results = svc.search(query, opts)
        items = [{"score": round(r.score, 4), **memory_to_dict(r.memory)} for r in results]
        return {"results": items, "total": len(items), "query": query}
    finally:
        storage.close()


@mcp.tool()
def cortex_create(
    title: str,
    content: str,
    level: str = "episodic",
    tags: str = "",
    session_id: str = "",
    source: str = "llm",
    task_id: str = "",
    author: str = "",
    git_branch: str = "",
    agent_name: str = "",
    agent_session_id: str = "",
    user_prompt: str = "",
) -> dict[str, Any]:
    """Create a new memory.

    Args:
        title: Memory title (3-60 characters).
        content: Memory content (minimum 10 characters, Markdown supported).
        level: Memory level: working, episodic, or semantic.
        tags: Comma-separated tags.
        session_id: Session ID (required for working level).
        source: Origin source: manual, auto, or llm.
        task_id: Associated task/ticket ID.
        author: Author identifier.
        git_branch: Git branch at creation time (auto-detected if omitted).
        agent_name: Name of the agent that created the memory.
        agent_session_id: Agent session identifier.
        user_prompt: User prompt that triggered creation of this memory.

    Returns:
        The created memory.
    """
    mem_level = MemoryLevel(level)
    mem_source = MemorySource(source)
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    if mem_level == MemoryLevel.working and not session_id:
        settings = get_settings()
        session_id = derive_session_id(settings.session)

    svc, storage = _get_svc()
    try:
        memory = svc.create(
            CreateInput(
                title=title,
                content=content,
                level=mem_level,
                tags=tag_list,
                session_id=session_id,
                source=mem_source,
                task_id=task_id,
                author=author,
                git_branch=git_branch,
                agent_name=agent_name,
                agent_session_id=agent_session_id,
                user_prompt=user_prompt,
            )
        )
        level_val = str(memory.level)
        return {
            "id": memory.id,
            "level": level_val,
            "title": memory.title,
            "tags": tag_list,
        }
    finally:
        storage.close()


@mcp.tool()
def cortex_list(
    level: str = "",
    session_id: str = "",
    include_obsolete: bool = False,
    limit: int = 0,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List memories with optional filtering.

    Args:
        level: Filter by level (working/episodic/semantic). Empty = all.
        session_id: Filter working memories by session ID.
        include_obsolete: Include obsolete memories.
        limit: Maximum results (0 = unlimited).
        offset: Number of results to skip.

    Returns:
        List of memories.
    """
    filter_level: MemoryLevel | None = MemoryLevel(level) if level else None
    storage = get_storage()
    try:
        opts = ListOptions(
            level=filter_level,
            session_id=session_id,
            include_obsolete=include_obsolete,
            limit=limit,
            offset=offset,
        )
        memories = storage.list(opts)
        items = [memory_to_dict(m, compact=True) for m in memories]
        return {"memories": items, "total": len(items)}
    finally:
        storage.close()


@mcp.tool()
def cortex_get(memory_id: str) -> dict[str, Any]:
    """Retrieve a memory by ID or unique prefix.

    Args:
        memory_id: Full UUID or unique ID prefix.

    Returns:
        The memory, or an error if not found.
    """
    storage = get_storage()
    try:
        memory = storage.get(memory_id)
        return memory_to_dict(memory)
    finally:
        storage.close()


@mcp.tool()
def cortex_consolidate(
    synthesis: str,
    level: str = "semantic",
    title: str = "",
    tags: str = "",
    session_id: str = "",
    source: str = "llm",
    force: bool = False,
    git_branch: str = "",
    agent_name: str = "",
    agent_session_id: str = "",
    user_prompt: str = "",
) -> dict[str, Any]:
    """Create or merge a memory based on semantic similarity.

    Searches for a similar memory (score >= threshold). If found, merges
    content. If not, creates a new memory. Use force=True to always create.

    Args:
        synthesis: Content to consolidate.
        level: Target memory level.
        title: Title (derived from content if omitted).
        tags: Comma-separated tags.
        session_id: Session ID (required for working level).
        source: Source: manual, auto, or llm.
        force: Skip duplicate detection and always create new memory.
        git_branch: Git branch at creation time (auto-detected if omitted).
        agent_name: Name of the agent that created the memory.
        agent_session_id: Agent session identifier.
        user_prompt: User prompt that triggered consolidation.

    Returns:
        ConsolidateResult with action, memory_id, level, similarity, message.
    """
    mem_level = MemoryLevel(level)
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    if mem_level == MemoryLevel.working and not session_id:
        settings = get_settings()
        session_id = derive_session_id(settings.session)

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
                source=MemorySource(source),
                force=force,
                git_branch=git_branch,
                agent_name=agent_name,
                agent_session_id=agent_session_id,
                user_prompt=user_prompt,
            )
        )
        return result.model_dump()
    finally:
        storage.close()


@mcp.tool()
def cortex_promote_memory(memory_id: str, target_level: str = "semantic") -> dict[str, Any]:
    """Promote a memory to a higher layer.

    For episodic → semantic promotions, a new memory is created to preserve
    lineage. The original is marked obsolete.

    Args:
        memory_id: ID of the memory to promote.
        target_level: Target level (must be higher than current).

    Returns:
        The promoted (or new) memory.
    """
    target = MemoryLevel(target_level)
    storage = get_storage()
    embedder = get_embedder()
    svc = ConsolidationService(storage=storage, embedder=embedder)

    try:
        if target == MemoryLevel.semantic:
            memory = svc.promote_to_semantic(memory_id)
        else:
            mem_svc = MemoryService(storage, embedder)
            memory = mem_svc.promote(memory_id, target)
        level_val = str(memory.level)
        return {
            "id": memory.id,
            "level": level_val,
            "previous_level": target_level,
            "status": "promoted",
        }
    finally:
        storage.close()


@mcp.tool()
def cortex_demote_memory(memory_id: str, target_level: str = "episodic") -> dict[str, Any]:
    """Demote a memory to a lower layer (e.g. semantic → episodic).

    Args:
        memory_id: ID of the memory to demote.
        target_level: Target level (must be lower than current).

    Returns:
        The demoted memory summary.
    """
    target = MemoryLevel(target_level)
    svc, storage = _get_svc()
    try:
        memory = svc.demote(memory_id, target)
        level_val = str(memory.level)
        return {
            "id": memory.id,
            "level": level_val,
            "status": "demoted",
        }
    finally:
        storage.close()


@mcp.tool()
def cortex_update_memory(
    memory_id: str,
    title: str = "",
    content: str = "",
    tags: str = "",
) -> dict[str, Any]:
    """Update an existing memory's fields.

    Args:
        memory_id: ID of the memory to update.
        title: New title (leave empty to keep current).
        content: New content (leave empty to keep current).
        tags: New comma-separated tags (leave empty to keep current).

    Returns:
        The updated memory.
    """
    storage = get_storage()
    embedder = get_embedder()
    svc = MemoryService(storage, embedder)

    try:
        memory = storage.get(memory_id)
        if title:
            memory.title = title
        if content:
            memory.content = content
        if tags:
            memory.tags = [t.strip() for t in tags.split(",") if t.strip()]
        updated = svc.update(memory)
        return memory_to_dict(updated)
    finally:
        storage.close()


@mcp.tool()
def cortex_mark_obsolete(memory_id: str) -> dict[str, Any]:
    """Soft-delete a memory by marking it as obsolete.

    Obsolete memories are excluded from search results by default.

    Args:
        memory_id: ID of the memory to mark obsolete.

    Returns:
        The updated memory with obsolete=True.
    """
    storage = get_storage()
    embedder = get_embedder()
    svc = MemoryService(storage, embedder)

    try:
        memory = svc.mark_obsolete(memory_id)
        return memory_to_dict(memory)
    finally:
        storage.close()


@mcp.tool()
def cortex_review_session(session_id: str = "") -> dict[str, Any]:
    """Review working memories for the current session.

    Returns a summary of session memories that may be ready for transfer
    or consolidation into higher layers.

    Args:
        session_id: Session ID to review (derived from git branch if omitted).

    Returns:
        Summary with memory count and list of titles.
    """
    if not session_id:
        settings = get_settings()
        session_id = derive_session_id(settings.session)

    storage = get_storage()
    try:
        opts = ListOptions(
            level=MemoryLevel.working,
            session_id=session_id,
            include_obsolete=False,
        )
        memories = storage.list(opts)
        return {
            "session_id": session_id,
            "count": len(memories),
            "memories": [
                {
                    "id": m.id[:8],
                    "title": m.title,
                    "tags": m.tags,
                    "updated_at": m.updated_at.isoformat(),
                }
                for m in memories
            ],
            "suggestion": (
                "Consider transferring to episodic with cortex_consolidate or transfer-working."
                if memories
                else "No working memories for this session."
            ),
        }
    finally:
        storage.close()


# ------------------------------------------------------------------
# Thinking / decision tools (return guidance text)
# ------------------------------------------------------------------


@mcp.tool()
def cortex_think_about_memory_maintenance() -> str:
    """Think through memory maintenance for the current session.

    Returns guidance on when and how to use memory operations for
    effective knowledge capture and maintenance.
    """
    settings = get_settings()
    try:
        session_id = derive_session_id(settings.session)
    except RuntimeError:
        session_id = "unknown"

    storage = get_storage()
    try:
        counts = storage.stats()
    finally:
        storage.close()

    lines = [
        f"Session: {session_id} | Counts: {json.dumps(counts)}",
    ]
    if counts.get("working", 0) > 0:
        lines.append(
            f"- {counts['working']} working memories: review_session → transfer or consolidate"
        )
    if counts.get("episodic", 0) > 10:
        lines.append(
            f"- {counts['episodic']} episodic: consider autoprune "
            f"(dup>{settings.autoprune.duplicates_threshold}, "
            f"age>{settings.autoprune.episodic_retention_days}d)"
        )
    if counts.get("semantic", 0) > 20:
        lines.append(
            f"- {counts['semantic']} semantic: consider merge "
            f"(>{settings.autoprune.semantic_merge_threshold})"
        )
    threshold = settings.consolidation.similarity_threshold
    lines.append(
        f"Ops: create, consolidate(threshold={threshold}), search, mark_obsolete, transfer-working"
    )
    return "\n".join(lines)


@mcp.tool()
def cortex_think_about_task_completion() -> str:
    """Think through what to capture at task completion.

    Returns a checklist for knowledge capture when finishing a task.
    """
    return (
        "Task completion checklist:\n"
        "1. Decisions → consolidate level=semantic\n"
        "2. Bugs fixed → create level=episodic tags=bug\n"
        "3. Patterns → consolidate level=semantic (auto-dedup)\n"
        "4. Working cleanup → review_session → transfer-working\n"
        "5. Obsolete knowledge → mark_obsolete\n"
        "Priority: patterns→semantic, events→episodic, temp→working→transfer"
    )


@mcp.tool()
def cortex_choose_memory_layer(
    description: str,
    is_permanent: bool = False,
    is_session_scoped: bool = False,
) -> dict[str, str]:
    """Recommend the appropriate memory layer for a piece of knowledge.

    Args:
        description: Description of the knowledge to store.
        is_permanent: True if this is reusable, permanent knowledge.
        is_session_scoped: True if this is only relevant for the current session.

    Returns:
        Recommendation with level, rationale, and suggested tags.
    """
    if is_session_scoped:
        level = "working"
        rationale = "Session-scoped temporary context. Transfer to episodic at session end."
    elif is_permanent:
        level = "semantic"
        rationale = "Permanent, reusable knowledge. Will be searchable across all sessions."
    else:
        level = "episodic"
        rationale = "Time-bound event or decision. Retained for 90 days by default."

    # Suggest tags based on common keywords in description
    lower = description.lower()
    suggested_tags: list[str] = []
    keyword_map = {
        "bug": "bug",
        "fix": "bug",
        "error": "bug",
        "pattern": "pattern",
        "convention": "convention",
        "architecture": "architecture",
        "api": "api",
        "auth": "auth",
        "database": "database",
        "db": "database",
        "test": "test",
        "performance": "performance",
        "security": "security",
    }
    for keyword, tag in keyword_map.items():
        if keyword in lower and tag not in suggested_tags:
            suggested_tags.append(tag)

    return {
        "recommended_level": level,
        "rationale": rationale,
        "suggested_tags": ", ".join(suggested_tags[:3]),
    }


@mcp.tool()
def cortex_choose_working_consolidation(session_id: str = "") -> dict[str, Any]:
    """Recommend how to handle working memories for the current session.

    Analyzes working memories and suggests whether to transfer, consolidate,
    or discard each one.

    Args:
        session_id: Session ID (derived from git branch if omitted).

    Returns:
        Recommendations per memory.
    """
    if not session_id:
        settings = get_settings()
        session_id = derive_session_id(settings.session)

    storage = get_storage()
    try:
        opts = ListOptions(
            level=MemoryLevel.working,
            session_id=session_id,
            include_obsolete=False,
        )
        memories = storage.list(opts)

        recommendations = []
        for m in memories:
            # Heuristic: long content → consolidate, short → transfer
            action = "consolidate" if len(m.content) > 500 else "transfer"
            recommendations.append({"id": m.id[:8], "title": m.title, "action": action})

        return {
            "session_id": session_id,
            "count": len(memories),
            "recommendations": recommendations,
        }
    finally:
        storage.close()


# ------------------------------------------------------------------
# Server runner
# ------------------------------------------------------------------


def run_server(transport: str = "stdio", address: str = ":8080") -> None:
    """Start the Cortex MCP server with the specified transport."""
    if transport == "sse":
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")
