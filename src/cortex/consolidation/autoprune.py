"""Autoprune service - automated memory maintenance and optimization."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta

import numpy as np

from cortex.models.memory import Memory, MemoryLevel
from cortex.models.results import AutopruneResult, AutopruneStats
from cortex.search.cosine import cosine_similarity, normalize
from cortex.storage.chroma import ChromaStorage

_MERGE_SEPARATOR = "\n\n---\n\n"


class AutopruneService:
    """Runs three automated cleanup operations:

    1. Remove duplicates - pairwise similarity >= duplicates_threshold (0.92)
    2. Archive episodic - delete episodic memories older than retention_days (90)
    3. Merge semantic - merge very similar semantic memories (>= semantic_merge_threshold 0.88)
    """

    def __init__(
        self,
        storage: ChromaStorage,
        duplicates_threshold: float = 0.92,
        episodic_retention_days: int = 90,
        semantic_merge_threshold: float = 0.88,
    ) -> None:
        self._storage = storage
        self._dup_threshold = duplicates_threshold
        self._retention_days = episodic_retention_days
        self._semantic_threshold = semantic_merge_threshold

    def run(self, dry_run: bool = False) -> AutopruneResult:
        """Execute all three autoprune operations in sequence."""
        result = AutopruneResult(dry_run=dry_run)
        result.duplicates = self._remove_duplicates(dry_run)
        result.episodic = self._archive_episodic(dry_run)
        result.semantic = self._merge_semantic(dry_run)
        return result

    # ------------------------------------------------------------------
    # Operation 1: Remove duplicates
    # ------------------------------------------------------------------

    def _remove_duplicates(self, dry_run: bool) -> AutopruneStats:
        """Find and remove near-duplicate memories across all levels."""
        stats = AutopruneStats()

        for level in [MemoryLevel.episodic, MemoryLevel.semantic]:
            items = self._storage.get_all_with_embeddings(level)
            seen_ids: set[str] = set()
            deleted_ids: set[str] = set()

            for i, (mem_a, vec_a) in enumerate(items):
                if mem_a.id in deleted_ids or not vec_a:
                    continue

                for mem_b, vec_b in items[i + 1 :]:
                    if mem_b.id in deleted_ids or not vec_b:
                        continue
                    if mem_b.id in seen_ids:
                        continue

                    score = cosine_similarity(vec_a, vec_b)
                    if score >= self._dup_threshold:
                        # Delete the one updated less recently
                        to_delete = mem_b if mem_a.updated_at >= mem_b.updated_at else mem_a
                        if not dry_run:
                            with contextlib.suppress(KeyError):
                                self._storage.delete(to_delete.id)
                        deleted_ids.add(to_delete.id)
                        stats.removed += 1
                        stats.details.append(
                            f"Removed duplicate {to_delete.id[:8]} (score={score:.3f})"
                        )

                seen_ids.add(mem_a.id)

        return stats

    # ------------------------------------------------------------------
    # Operation 2: Archive episodic memories
    # ------------------------------------------------------------------

    def _archive_episodic(self, dry_run: bool) -> AutopruneStats:
        """Delete episodic memories older than the retention threshold."""
        stats = AutopruneStats()
        cutoff = datetime.now(UTC) - timedelta(days=self._retention_days)

        items = self._storage.get_all_with_embeddings(MemoryLevel.episodic)
        for mem, _ in items:
            if mem.created_at < cutoff and not mem.obsolete:
                if not dry_run:
                    with contextlib.suppress(KeyError):
                        self._storage.delete(mem.id)
                stats.archived += 1
                stats.details.append(
                    f"Archived episodic {mem.id[:8]} (age={mem.created_at.date()})"
                )

        return stats

    # ------------------------------------------------------------------
    # Operation 3: Merge similar semantic memories
    # ------------------------------------------------------------------

    def _merge_semantic(self, dry_run: bool) -> AutopruneStats:
        """Merge pairs of very similar semantic memories."""
        stats = AutopruneStats()
        items = self._storage.get_all_with_embeddings(MemoryLevel.semantic)
        merged_ids: set[str] = set()

        for i, (mem_a, vec_a) in enumerate(items):
            if mem_a.id in merged_ids or not vec_a:
                continue

            for mem_b, vec_b in items[i + 1 :]:
                if mem_b.id in merged_ids or not vec_b:
                    continue

                score = cosine_similarity(vec_a, vec_b)
                if score >= self._semantic_threshold:
                    if not dry_run:
                        self._do_merge_semantic(mem_a, vec_a, mem_b, vec_b)
                    merged_ids.add(mem_b.id)
                    stats.merged += 1
                    stats.details.append(
                        f"Merged semantic {mem_b.id[:8]} into {mem_a.id[:8]} (score={score:.3f})"
                    )

        return stats

    def _do_merge_semantic(
        self,
        target: Memory,
        target_vec: list[float],
        source: Memory,
        source_vec: list[float],
    ) -> None:
        """Merge source into target, deleting source."""
        target.content = target.content + _MERGE_SEPARATOR + source.content
        target.tags = _dedupe_list(target.tags + source.tags)
        target.merged_from = _dedupe_list([*target.merged_from, source.id, *source.merged_from])
        target.touch()

        # Average the two embeddings
        averaged = np.mean([target_vec, source_vec], axis=0).tolist()
        target.embedding = normalize(averaged)

        self._storage.update(target)
        with contextlib.suppress(KeyError):
            self._storage.delete(source.id)


def _dedupe_list(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
