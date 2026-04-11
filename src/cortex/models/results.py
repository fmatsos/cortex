"""Result types for Cortex operations."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from cortex.models.memory import Memory


class SearchResult(BaseModel):
    """A memory with its similarity score from a search operation."""

    memory: Memory
    score: float


class ConsolidateResult(BaseModel):
    """Result of a consolidation (create or merge) operation."""

    action: Literal["created", "merged"]
    memory_id: str
    level: str
    similarity: float = Field(default=0.0, ge=0.0, le=1.0)
    message: str


class AutopruneStats(BaseModel):
    """Statistics from a single autoprune operation."""

    removed: int = Field(default=0, ge=0)
    merged: int = Field(default=0, ge=0)
    archived: int = Field(default=0, ge=0)
    details: list[str] = Field(default_factory=list)


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
