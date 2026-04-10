"""Tests for AutopruneService."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from cortex.consolidation.autoprune import AutopruneService
from cortex.models.memory import MemoryLevel
from cortex.storage.chroma import ChromaStorage
from tests.conftest import MockEmbedder
from tests.test_storage import make_memory


class TestAutopruneService:
    def _make_svc(
        self,
        chroma_storage: ChromaStorage,
        dup_threshold: float = 0.92,
        retention_days: int = 90,
        semantic_threshold: float = 0.88,
    ) -> AutopruneService:
        return AutopruneService(
            storage=chroma_storage,
            duplicates_threshold=dup_threshold,
            episodic_retention_days=retention_days,
            semantic_merge_threshold=semantic_threshold,
        )

    def test_remove_duplicates_dry_run(
        self, chroma_storage: ChromaStorage, mock_embedder: MockEmbedder
    ) -> None:
        # Use threshold=-1.0 so any two memories are "duplicates" regardless
        # of their actual cosine similarity (which can be slightly negative for
        # random unrelated vectors).
        svc = self._make_svc(chroma_storage, dup_threshold=-1.0)

        m1 = make_memory(level=MemoryLevel.episodic, title="Duplicate A")
        m2 = make_memory(level=MemoryLevel.episodic, title="Duplicate B")
        chroma_storage.save(m1)
        chroma_storage.save(m2)

        stats = svc._remove_duplicates(dry_run=True)
        # Dry run: memories still there
        assert len(chroma_storage.list()) == 2
        assert stats.removed > 0

    def test_remove_duplicates_removes(
        self, chroma_storage: ChromaStorage, mock_embedder: MockEmbedder
    ) -> None:
        svc = self._make_svc(chroma_storage, dup_threshold=-1.0)

        m1 = make_memory(level=MemoryLevel.episodic, title="Duplicate A")
        m2 = make_memory(level=MemoryLevel.episodic, title="Duplicate B")
        chroma_storage.save(m1)
        chroma_storage.save(m2)

        svc._remove_duplicates(dry_run=False)
        remaining = chroma_storage.list()
        assert len(remaining) == 1

    def test_archive_episodic_old(
        self, chroma_storage: ChromaStorage, mock_embedder: MockEmbedder
    ) -> None:
        # Create old memory
        m = make_memory(level=MemoryLevel.episodic, title="Old episodic")
        m.created_at = datetime.now(UTC) - timedelta(days=100)
        chroma_storage.save(m)

        svc = self._make_svc(chroma_storage, retention_days=90)
        stats = svc._archive_episodic(dry_run=False)
        assert stats.archived == 1
        assert len(chroma_storage.list()) == 0

    def test_archive_episodic_recent_kept(
        self, chroma_storage: ChromaStorage, mock_embedder: MockEmbedder
    ) -> None:
        m = make_memory(level=MemoryLevel.episodic, title="Recent episodic")
        chroma_storage.save(m)

        svc = self._make_svc(chroma_storage, retention_days=90)
        stats = svc._archive_episodic(dry_run=False)
        assert stats.archived == 0
        assert len(chroma_storage.list()) == 1

    def test_full_run_returns_result(
        self, chroma_storage: ChromaStorage, mock_embedder: MockEmbedder
    ) -> None:
        svc = self._make_svc(chroma_storage)
        result = svc.run(dry_run=True)
        assert result.dry_run is True
        assert result.duplicates is not None
        assert result.episodic is not None
        assert result.semantic is not None
