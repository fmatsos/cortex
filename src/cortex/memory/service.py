"""Memory service — orchestrates storage and embeddings."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

from cortex.embeddings.base import Embedder
from cortex.models.memory import Memory, MemoryContext, MemoryLevel, MemorySource
from cortex.models.results import SearchResult
from cortex.storage.base import ListOptions, SearchOptions, Storage


@dataclass
class CreateInput:
    """Input parameters for creating a memory."""

    title: str
    content: str
    level: MemoryLevel
    tags: list[str] = field(default_factory=list)
    session_id: str = ""
    source: MemorySource = MemorySource.manual
    task_id: str = ""
    author: str = ""


class MemoryService:
    """Orchestrates memory creation, retrieval, search and lifecycle.

    Responsibilities:
    - Generate embeddings for new/updated memories
    - Delegate persistence to the Storage backend
    - Manage LRU embedding cache on the Embedder
    """

    EMBED_TEXT_TEMPLATE = "Title: {title}\n\nContent: {content}\n\nTags: {tags}"

    def __init__(self, storage: Storage, embedder: Embedder) -> None:
        self._storage = storage
        self._embedder = embedder

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def create(self, inp: CreateInput) -> Memory:
        """Create and persist a new memory with embedding."""
        context = MemoryContext(
            session_id=inp.session_id,
            task_id=inp.task_id,
            author=inp.author,
            source=inp.source,
            timestamp=datetime.now(UTC),
        )

        memory = Memory(
            id=str(uuid4()),
            level=inp.level,
            title=inp.title,
            content=inp.content,
            tags=inp.tags,
            context=context,
        )

        embed_text = self._embed_text(memory)
        memory.embedding = self._embedder.embed(embed_text)
        self._storage.save(memory)
        return memory

    def update(self, memory: Memory) -> Memory:
        """Update an existing memory (re-embeds if content changed)."""
        memory.touch()
        embed_text = self._embed_text(memory)
        memory.embedding = self._embedder.embed(embed_text)
        self._storage.update(memory)
        return memory

    def delete(self, memory_id: str) -> None:
        """Permanently delete a memory."""
        self._storage.delete(memory_id)

    def mark_obsolete(self, memory_id: str) -> Memory:
        """Soft-delete: mark a memory as obsolete."""
        memory = self._storage.get(memory_id)
        memory.obsolete = True
        memory.touch()
        self._storage.update(memory)
        return memory

    def transfer_working(self, session_id: str) -> int:
        """Transfer all working memories for a session to episodic layer."""
        return self._storage.transfer_working_to_episodic(session_id)

    def promote(self, memory_id: str, target_level: MemoryLevel) -> Memory:
        """Promote a memory to a higher layer (e.g. episodic → semantic)."""
        memory = self._storage.get(memory_id)
        memory.level = target_level
        memory.touch()
        self._storage.update(memory)
        return memory

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def get(self, memory_id: str) -> Memory:
        """Retrieve a memory by ID or unique prefix."""
        return self._storage.get(memory_id)

    def list(self, opts: ListOptions | None = None) -> list[Memory]:
        """List memories with optional filtering."""
        return self._storage.list(opts)

    def search(
        self,
        query: str,
        opts: SearchOptions | None = None,
    ) -> list[SearchResult]:
        """Semantic search across all memory layers."""
        query_vector = self._embedder.embed(query)
        return self._storage.search_all_layers(query_vector, opts)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @classmethod
    def _embed_text(cls, memory: Memory) -> str:
        """Build the canonical embedding text for a memory."""
        tags_str = ", ".join(memory.tags) if memory.tags else ""
        return cls.EMBED_TEXT_TEMPLATE.format(
            title=memory.title,
            content=memory.content,
            tags=tags_str,
        )
