"""Cortex MCP server — exposes 16 tools for Claude Code integration.

Features:
- Service singleton with atexit cleanup (persistent embedder LRU cache)
- TTL search result cache (30s, write-invalidated)
- Compact search response with optional full_content flag
- Relation graph tools: cortex_get_related, cortex_link
- Alphabetically sorted tools and parameters
"""

from __future__ import annotations

import atexit
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any

from mcp.server.fastmcp import FastMCP

from cortex.cli._common import memory_to_dict
from cortex.config.settings import get_settings
from cortex.consolidation.service import ConsolidateInput, ConsolidationService
from cortex.embeddings.ollama import OllamaEmbedder
from cortex.memory.service import CreateInput, MemoryService
from cortex.models.memory import MemoryLevel, MemorySource
from cortex.session import derive_session_id
from cortex.storage.base import ListOptions, SearchOptions
from cortex.storage.chroma import ChromaStorage

mcp = FastMCP("cortex")

# ------------------------------------------------------------------
# Service singleton & search cache
# ------------------------------------------------------------------

_storage: ChromaStorage | None = None
_embedder: OllamaEmbedder | None = None


def _get_svc() -> tuple[MemoryService, ChromaStorage]:
    """Get or create singleton MemoryService and storage.

    The singleton persists across tool calls, keeping the embedder's LRU
    cache alive and avoiding repeated ChromaDB connection initialization.
    """
    global _storage, _embedder
    if _storage is None:
        settings = get_settings()
        _storage = ChromaStorage(path=settings.storage.path)
        _embedder = OllamaEmbedder(config=settings.embeddings)
    return MemoryService(_storage, _embedder), _storage


def _cleanup() -> None:
    """Cleanup called on interpreter exit via atexit."""
    global _storage, _embedder
    if _storage is not None:
        _storage.close()
        _storage = None
    if _embedder is not None:
        _embedder.close()
        _embedder = None


atexit.register(_cleanup)


# ------------------------------------------------------------------
# TTL cache for search results (write-invalidated, 30s TTL)
# ------------------------------------------------------------------


@dataclass
class _CacheEntry:
    """Cache entry with expiration timestamp."""

    data: Any
    expires_at: float


class _TTLCache:
    """Simple in-memory TTL cache, write-invalidated on memory mutations."""

    def __init__(self, ttl: float = 30.0) -> None:
        self._store: dict[str, _CacheEntry] = {}
        self._ttl = ttl

    def get(self, key: str) -> Any | None:
        """Get cached entry if not expired, else None."""
        entry = self._store.get(key)
        if entry and time.monotonic() < entry.expires_at:
            return entry.data
        return None

    def set(self, key: str, data: Any) -> None:
        """Cache data with TTL."""
        self._store[key] = _CacheEntry(data, time.monotonic() + self._ttl)

    def invalidate(self) -> None:
        """Clear all cached entries (called on write ops)."""
        self._store.clear()


_search_cache = _TTLCache(ttl=30.0)


# ------------------------------------------------------------------
# MCP tools (alphabetically sorted by name)
# ------------------------------------------------------------------


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
        "api": "api",
        "architecture": "architecture",
        "auth": "auth",
        "bug": "bug",
        "convention": "convention",
        "database": "database",
        "db": "database",
        "error": "bug",
        "fix": "bug",
        "pattern": "pattern",
        "performance": "performance",
        "security": "security",
        "test": "test",
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

    svc, _ = _get_svc()
    opts = ListOptions(
        level=MemoryLevel.working,
        session_id=session_id,
        include_obsolete=False,
    )
    memories = svc.list(opts)

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


@mcp.tool()
def cortex_consolidate(
    synthesis: str,
    agent_name: str = "",
    agent_session_id: str = "",
    force: bool = False,
    git_branch: str = "",
    level: str = "semantic",
    session_id: str = "",
    source: str = "llm",
    tags: str = "",
    title: str = "",
    user_prompt: str = "",
) -> dict[str, Any]:
    """Create or merge a memory based on semantic similarity.

    Searches for a similar memory (score >= threshold). If found, merges
    content. If not, creates a new memory. Use force=True to always create.

    Args:
        agent_name: Name of the agent that created the memory.
        agent_session_id: Agent session identifier.
        force: Skip duplicate detection and always create new memory.
        git_branch: Git branch at creation time (auto-detected if omitted).
        level: Target memory level.
        session_id: Session ID (required for working level).
        source: Source: manual, auto, or llm.
        synthesis: Content to consolidate.
        tags: Comma-separated tags.
        title: Title (derived from content if omitted).
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
    _, storage = _get_svc()
    consolidation_svc = ConsolidationService(
        storage=storage,
        embedder=_embedder,
        similarity_threshold=settings.consolidation.similarity_threshold,
    )

    result = consolidation_svc.consolidate(
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
    _search_cache.invalidate()
    return result.model_dump()


@mcp.tool()
def cortex_create(
    content: str,
    title: str,
    agent_name: str = "",
    agent_session_id: str = "",
    author: str = "",
    git_branch: str = "",
    level: str = "episodic",
    session_id: str = "",
    source: str = "llm",
    tags: str = "",
    task_id: str = "",
    user_prompt: str = "",
) -> dict[str, Any]:
    """Create a new memory.

    Args:
        content: Memory content (minimum 10 characters, Markdown supported).
        title: Memory title (3-60 characters).
        agent_name: Name of the agent that created the memory.
        agent_session_id: Agent session identifier.
        author: Author identifier.
        git_branch: Git branch at creation time (auto-detected if omitted).
        level: Memory level: working, episodic, or semantic.
        session_id: Session ID (required for working level).
        source: Origin source: manual, auto, or llm.
        tags: Comma-separated tags.
        task_id: Associated task/ticket ID.
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

    svc, _ = _get_svc()
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
    _search_cache.invalidate()
    level_val = str(memory.level)
    return {
        "id": memory.id,
        "level": level_val,
        "title": memory.title,
        "tags": tag_list,
    }


@mcp.tool()
def cortex_demote_memory(
    memory_id: str,
    target_level: str = "episodic",
) -> dict[str, Any]:
    """Demote a memory to a lower layer (e.g. semantic → episodic).

    Args:
        memory_id: ID of the memory to demote.
        target_level: Target level (must be lower than current).

    Returns:
        The demoted memory summary.
    """
    target = MemoryLevel(target_level)
    svc, _ = _get_svc()
    memory = svc.demote(memory_id, target)
    _search_cache.invalidate()
    level_val = str(memory.level)
    return {
        "id": memory.id,
        "level": level_val,
        "status": "demoted",
    }


@mcp.tool()
def cortex_get(memory_id: str) -> dict[str, Any]:
    """Retrieve a memory by ID or unique prefix.

    Args:
        memory_id: Full UUID or unique ID prefix.

    Returns:
        The memory, or an error if not found.
    """
    svc, _ = _get_svc()
    memory = svc.get(memory_id)
    return memory_to_dict(memory)


@mcp.tool()
def cortex_get_related(
    memory_id: str,
    include_lineage: bool = True,
) -> dict[str, Any]:
    """Return the relation graph for a memory.

    Shows what other memories this memory is related to
    (similarity-detected or explicitly linked) and its
    consolidation lineage (merged_from).

    Args:
        memory_id: ID or unique prefix of the memory.
        include_lineage: Include merged_from chain (default True).

    Returns:
        Dict with root memory, related memories, and lineage.
    """
    svc, _ = _get_svc()
    root = svc.get(memory_id)
    related = []
    for rid in root.context.related_memories:
        try:
            related.append(memory_to_dict(svc.get(rid), snippet_len=200))
        except KeyError:
            related.append({"id": rid, "error": "not found"})
    lineage = []
    if include_lineage:
        for lid in root.merged_from:
            try:
                lineage.append(memory_to_dict(svc.get(lid), snippet_len=200))
            except KeyError:
                lineage.append({"id": lid, "error": "not found"})
    return {
        "memory": memory_to_dict(root, snippet_len=200),
        "related": related,
        "lineage": lineage,
    }


@mcp.tool()
def cortex_link(
    memory_id: str,
    related_id: str,
) -> dict[str, Any]:
    """Explicitly link two memories as related (bidirectional).

    Adds each memory's ID to the other's related_memories list.
    Useful for declaring semantic connections not detected automatically.

    Args:
        memory_id: ID or unique prefix of the first memory.
        related_id: ID or unique prefix of the second memory.

    Returns:
        Dict with both updated memory IDs.
    """
    svc, _ = _get_svc()
    a = svc.get(memory_id)
    b = svc.get(related_id)
    if b.id not in a.context.related_memories:
        a.context.related_memories.append(b.id)
        svc.update(a, content_changed=False)
    if a.id not in b.context.related_memories:
        b.context.related_memories.append(a.id)
        svc.update(b, content_changed=False)
    _search_cache.invalidate()
    return {"linked": [a.id[:8], b.id[:8]], "status": "ok"}


@mcp.tool()
def cortex_list(
    include_obsolete: bool = False,
    level: str = "",
    limit: int = 0,
    offset: int = 0,
    session_id: str = "",
) -> dict[str, Any]:
    """List memories with optional filtering.

    Args:
        include_obsolete: Include obsolete memories.
        level: Filter by level (working/episodic/semantic). Empty = all.
        limit: Maximum results (0 = unlimited).
        offset: Number of results to skip.
        session_id: Filter working memories by session ID.

    Returns:
        List of memories.
    """
    filter_level: MemoryLevel | None = MemoryLevel(level) if level else None
    svc, _ = _get_svc()
    opts = ListOptions(
        level=filter_level,
        session_id=session_id,
        include_obsolete=include_obsolete,
        limit=limit,
        offset=offset,
    )
    memories = svc.list(opts)
    items = [memory_to_dict(m, compact=True) for m in memories]
    return {"memories": items, "total": len(items)}


@mcp.tool()
def cortex_mark_obsolete(memory_id: str) -> dict[str, Any]:
    """Soft-delete a memory by marking it as obsolete.

    Obsolete memories are excluded from search results by default.

    Args:
        memory_id: ID of the memory to mark obsolete.

    Returns:
        The updated memory with obsolete=True.
    """
    svc, _ = _get_svc()
    memory = svc.mark_obsolete(memory_id)
    _search_cache.invalidate()
    return memory_to_dict(memory)


@mcp.tool()
def cortex_promote_memory(
    memory_id: str,
    target_level: str = "semantic",
) -> dict[str, Any]:
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
    svc, storage = _get_svc()
    if target == MemoryLevel.semantic:
        consolidation_svc = ConsolidationService(storage=storage, embedder=_embedder)
        memory = consolidation_svc.promote_to_semantic(memory_id)
    else:
        memory = svc.promote(memory_id, target)
    _search_cache.invalidate()
    level_val = str(memory.level)
    return {
        "id": memory.id,
        "level": level_val,
        "previous_level": target_level,
        "status": "promoted",
    }


@mcp.tool()
def cortex_review_session(session_id: str = "") -> dict[str, Any]:
    """Review working memories for the current session.

    Returns a summary of session memories that may be ready for transfer
    or consolidation into higher layers.

    Args:
        session_id: Session ID (derived from git branch if omitted).

    Returns:
        Summary with memory count and list of titles.
    """
    if not session_id:
        settings = get_settings()
        session_id = derive_session_id(settings.session)

    svc, _ = _get_svc()
    opts = ListOptions(
        level=MemoryLevel.working,
        session_id=session_id,
        include_obsolete=False,
    )
    memories = svc.list(opts)
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


@mcp.tool()
def cortex_search(
    query: str,
    full_content: bool = False,
    include_obsolete: bool = False,
    level: str = "",
    min_score: float = 0.5,
    session_id: str = "",
    top_k: int = 5,
) -> dict[str, Any]:
    """Search memories using semantic similarity.

    Results are cached for 30 seconds; cache is invalidated on any write operation.

    Args:
        query: The search query string.
        full_content: Return full memory content instead of 200-char snippet.
        include_obsolete: Include obsolete (soft-deleted) memories.
        level: Filter by memory level (working/episodic/semantic). Empty = all.
        min_score: Minimum similarity score threshold (0.0-1.0).
        session_id: Filter working memories by session ID.
        top_k: Maximum number of results to return.

    Returns:
        List of memories with similarity scores.
    """
    # Build cache key from all parameters (normalize for determinism)
    raw_key = f"{query}|{full_content}|{include_obsolete}|{level}|{min_score}|{session_id}|{top_k}"
    cache_key = hashlib.sha256(raw_key.encode()).hexdigest()[:16]

    # Check cache
    cached = _search_cache.get(cache_key)
    if cached is not None:
        return cached

    filter_levels: list[MemoryLevel] | None = None
    if level:
        filter_levels = [MemoryLevel(lv.strip()) for lv in level.split(",") if lv.strip()]

    svc, _ = _get_svc()
    opts = SearchOptions(
        top_k=top_k,
        min_score=min_score,
        filter_levels=filter_levels,
        include_obsolete=include_obsolete,
        session_id=session_id,
    )
    results = svc.search(query, opts)
    snippet_len = 0 if full_content else 200
    items = [
        {"score": round(r.score, 4), **memory_to_dict(r.memory, snippet_len=snippet_len)}
        for r in results
    ]
    response = {"results": items, "total": len(items), "query": query}

    # Cache the response
    _search_cache.set(cache_key, response)
    return response


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

    svc, _ = _get_svc()
    counts = svc._storage.stats()

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
def cortex_update_memory(
    memory_id: str,
    content: str = "",
    tags: str = "",
    title: str = "",
) -> dict[str, Any]:
    """Update an existing memory's fields.

    Args:
        memory_id: ID of the memory to update.
        content: New content (leave empty to keep current).
        tags: New comma-separated tags (leave empty to keep current).
        title: New title (leave empty to keep current).

    Returns:
        The updated memory.
    """
    svc, _ = _get_svc()
    memory = svc.get(memory_id)
    if title:
        memory.title = title
    if content:
        memory.content = content
    if tags:
        memory.tags = [t.strip() for t in tags.split(",") if t.strip()]
    updated = svc.update(memory)
    _search_cache.invalidate()
    return memory_to_dict(updated)


# ------------------------------------------------------------------
# Server runner
# ------------------------------------------------------------------


def run_server(transport: str = "stdio", address: str = ":8080") -> None:
    """Start the Cortex MCP server with the specified transport."""
    if transport == "sse":
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")
