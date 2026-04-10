"""Storage protocol for Cortex memory backends."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from cortex.models.memory import Memory, MemoryLevel
from cortex.models.results import SearchResult


class SearchOptions:
    """Options for semantic search across memory layers."""

    def __init__(
        self,
        top_k: int = 5,
        min_score: float = 0.5,
        filter_levels: list[MemoryLevel] | None = None,
        include_obsolete: bool = False,
        session_id: str = "",
    ) -> None:
        self.top_k = top_k
        self.min_score = min_score
        self.filter_levels = filter_levels
        self.include_obsolete = include_obsolete
        self.session_id = session_id


class ListOptions:
    """Options for listing memories with filtering and pagination."""

    def __init__(
        self,
        level: MemoryLevel | None = None,
        session_id: str = "",
        include_obsolete: bool = False,
        limit: int = 0,
        offset: int = 0,
        reverse: bool = False,
    ) -> None:
        self.level = level
        self.session_id = session_id
        self.include_obsolete = include_obsolete
        self.limit = limit
        self.offset = offset
        self.reverse = reverse


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

    def transfer_working_to_episodic(self, session_id: str) -> int:
        """Move all working memories for a session to episodic layer.

        Returns the number of transferred memories.
        """
        ...

    def close(self) -> None:
        """Release any resources held by the storage backend."""
        ...
