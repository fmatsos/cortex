"""Storage protocol for Cortex memory backends."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from cortex.models.memory import Memory, MemoryLevel
from cortex.models.results import SearchResult


@dataclass
class SearchOptions:
    """Options for semantic search across memory layers."""

    top_k: int = 5
    min_score: float = 0.5
    filter_levels: list[MemoryLevel] | None = field(default=None)
    include_obsolete: bool = False
    session_id: str = ""
    freshness_weight: float = 0.0


@dataclass
class ListOptions:
    """Options for listing memories with filtering and pagination."""

    level: MemoryLevel | None = None
    session_id: str = ""
    include_obsolete: bool = False
    limit: int = 0
    offset: int = 0
    reverse: bool = False
    git_branch: str = ""


@runtime_checkable
class Storage(Protocol):
    """Protocol for Cortex storage backends."""

    def save(self, memory: Memory) -> None:
        """Persist a new memory."""
        ...

    def get(self, memory_id: str) -> Memory:
        """Retrieve a memory by ID or unique ID prefix.

        Raises KeyError if not found, ValueError if prefix is ambiguous.
        """
        ...

    def list(self, opts: ListOptions | None = None) -> list[Memory]:
        """List memories with optional filtering."""
        ...

    def delete(self, memory_id: str) -> None:
        """Permanently remove a memory.

        Raises KeyError if not found.
        """
        ...

    def update(self, memory: Memory) -> None:
        """Replace an existing memory.

        Raises KeyError if not found.
        """
        ...

    def get_embedding(self, memory_id: str) -> list[float]:
        """Fetch the raw stored embedding for a single memory.

        Returns an empty list if the memory has no embedding or is not found.
        """
        ...

    def search_all_layers(
        self,
        vector: list[float],
        opts: SearchOptions | None = None,
    ) -> list[SearchResult]:
        """Semantic search across all memory layers."""
        ...

    def search_by_vector(
        self,
        vector: list[float],
        level: MemoryLevel,
        top_k: int = 10,
        min_score: float = 0.0,
        include_obsolete: bool = True,
        session_id: str = "",
    ) -> list[SearchResult]:
        """Search within a single level collection."""
        ...

    def get_all_with_embeddings(self, level: MemoryLevel) -> list[tuple[Memory, list[float]]]:
        """Retrieve all memories and their raw embeddings for a level."""
        ...

    def stats(self) -> dict[str, int]:
        """Return counts per memory level."""
        ...

    def transfer_working_to_episodic(self, session_id: str) -> int:
        """Move all working memories for a session to episodic layer.

        Returns the number of transferred memories.
        """
        ...

    def close(self) -> None:
        """Release any resources held by the storage backend."""
        ...
