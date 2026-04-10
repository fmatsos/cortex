"""Result types for Cortex operations."""

from __future__ import annotations

from pydantic import BaseModel

from cortex.models.memory import Memory


class SearchResult(BaseModel):
    """A memory with its similarity score from a search operation."""

    memory: Memory
    score: float


class ConsolidateResult(BaseModel):
    """Result of a consolidation (create or merge) operation."""

    action: str  # "created" | "merged"
    memory_id: str
    level: str
    similarity: float = 0.0
    message: str


class AutopruneStats(BaseModel):
    """Statistics from a single autoprune operation."""

    removed: int = 0
    merged: int = 0
    archived: int = 0
    details: list[str] = []


class AutopruneResult(BaseModel):
    """Result of an autoprune run."""

    duplicates: AutopruneStats = AutopruneStats()
    episodic: AutopruneStats = AutopruneStats()
    semantic: AutopruneStats = AutopruneStats()
    dry_run: bool = False

    @property
    def total_removed(self) -> int:
        return self.duplicates.removed + self.episodic.archived + self.semantic.merged

    def summary(self) -> str:
        parts = []
        if self.duplicates.removed:
            parts.append(f"{self.duplicates.removed} duplicates removed")
        if self.episodic.archived:
            parts.append(f"{self.episodic.archived} episodic memories archived")
        if self.semantic.merged:
            parts.append(f"{self.semantic.merged} semantic memories merged")
        if not parts:
            return "No memories pruned"
        prefix = "[dry-run] " if self.dry_run else ""
        return prefix + ", ".join(parts)
