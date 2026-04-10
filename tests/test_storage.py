"""Tests for ChromaDB storage backend."""

from __future__ import annotations

import pytest

from cortex.models.memory import Memory, MemoryContext, MemoryLevel
from cortex.storage.base import ListOptions, SearchOptions
from cortex.storage.chroma import ChromaStorage
from tests.conftest import MockEmbedder


def make_memory(
    level: MemoryLevel = MemoryLevel.episodic,
    title: str = "Test memory",
    content: str = "Test content that is long enough.",
    tags: list[str] | None = None,
    session_id: str = "",
) -> Memory:
    ctx = MemoryContext(session_id=session_id)
    embedder = MockEmbedder()
    m = Memory(level=level, title=title, content=content, tags=tags or [], context=ctx)
    from cortex.memory.service import MemoryService

    embed_text = MemoryService.EMBED_TEXT_TEMPLATE.format(
        title=m.title, content=m.content, tags=", ".join(m.tags)
    )
    m.embedding = embedder.embed(embed_text)
    return m


class TestCRUD:
    def test_save_and_get(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        chroma_storage.save(m)
        retrieved = chroma_storage.get(m.id)
        assert retrieved.id == m.id
        assert retrieved.title == m.title
        assert retrieved.content == m.content
        assert retrieved.level == MemoryLevel.episodic

    def test_get_not_found(self, chroma_storage: ChromaStorage) -> None:
        with pytest.raises(KeyError):
            chroma_storage.get("nonexistent-id")

    def test_get_by_prefix(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        chroma_storage.save(m)
        prefix = m.id[:8]
        retrieved = chroma_storage.get(prefix)
        assert retrieved.id == m.id

    def test_get_ambiguous_prefix(self, chroma_storage: ChromaStorage) -> None:
        # Save two memories with the same first character (rare but testable)
        m1 = make_memory(title="Memory one")
        m2 = make_memory(title="Memory two")
        m1.id = "aaaa1111-0000-0000-0000-000000000001"
        m2.id = "aaaa2222-0000-0000-0000-000000000002"
        chroma_storage.save(m1)
        chroma_storage.save(m2)
        with pytest.raises(ValueError, match="Ambiguous"):
            chroma_storage.get("aaaa")

    def test_delete(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        chroma_storage.save(m)
        chroma_storage.delete(m.id)
        with pytest.raises(KeyError):
            chroma_storage.get(m.id)

    def test_delete_not_found(self, chroma_storage: ChromaStorage) -> None:
        with pytest.raises(KeyError):
            chroma_storage.delete("nonexistent")

    def test_update(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory(title="Original title")
        chroma_storage.save(m)
        m.title = "Updated title"
        chroma_storage.update(m)
        retrieved = chroma_storage.get(m.id)
        assert retrieved.title == "Updated title"

    def test_update_not_found(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        with pytest.raises(KeyError):
            chroma_storage.update(m)


class TestList:
    def test_list_all(self, chroma_storage: ChromaStorage) -> None:
        m1 = make_memory(level=MemoryLevel.episodic, title="Episodic one")
        m2 = make_memory(level=MemoryLevel.semantic, title="Semantic one")
        chroma_storage.save(m1)
        chroma_storage.save(m2)
        all_memories = chroma_storage.list()
        assert len(all_memories) == 2

    def test_list_by_level(self, chroma_storage: ChromaStorage) -> None:
        m1 = make_memory(level=MemoryLevel.episodic, title="Episodic one")
        m2 = make_memory(level=MemoryLevel.semantic, title="Semantic one")
        chroma_storage.save(m1)
        chroma_storage.save(m2)
        episodic = chroma_storage.list(ListOptions(level=MemoryLevel.episodic))
        assert len(episodic) == 1
        assert episodic[0].level == MemoryLevel.episodic

    def test_list_excludes_obsolete(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        m.obsolete = True
        chroma_storage.save(m)
        result = chroma_storage.list()
        assert len(result) == 0

    def test_list_includes_obsolete_when_requested(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        m.obsolete = True
        chroma_storage.save(m)
        result = chroma_storage.list(ListOptions(include_obsolete=True))
        assert len(result) == 1

    def test_list_by_session(self, chroma_storage: ChromaStorage) -> None:
        m1 = make_memory(
            level=MemoryLevel.working,
            title="Session A memory",
            session_id="session-a",
        )
        m2 = make_memory(
            level=MemoryLevel.working,
            title="Session B memory",
            session_id="session-b",
        )
        chroma_storage.save(m1)
        chroma_storage.save(m2)
        result = chroma_storage.list(ListOptions(session_id="session-a"))
        assert len(result) == 1
        assert result[0].context.session_id == "session-a"


class TestSearch:
    def test_search_returns_results(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory(content="Authentication bug fix using JWT tokens")
        chroma_storage.save(m)
        embedder = MockEmbedder()
        query_vec = embedder.embed("JWT authentication")
        results = chroma_storage.search_all_layers(query_vec, SearchOptions(top_k=5, min_score=0.0))
        assert len(results) > 0

    def test_search_respects_min_score(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory()
        chroma_storage.save(m)
        embedder = MockEmbedder()
        query_vec = embedder.embed("completely unrelated dinosaurs")
        results = chroma_storage.search_all_layers(
            query_vec, SearchOptions(top_k=5, min_score=0.99)
        )
        # Very high threshold — likely no results
        for r in results:
            assert r.score >= 0.99

    def test_search_excludes_obsolete(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory(content="Auth token management")
        m.obsolete = True
        chroma_storage.save(m)
        embedder = MockEmbedder()
        query_vec = embedder.embed("auth token")
        results = chroma_storage.search_all_layers(
            query_vec, SearchOptions(top_k=5, min_score=0.0, include_obsolete=False)
        )
        assert all(not r.memory.obsolete for r in results)


class TestTransferWorking:
    def test_transfer_moves_to_episodic(self, chroma_storage: ChromaStorage) -> None:
        m = make_memory(
            level=MemoryLevel.working,
            title="Working memory",
            session_id="session-test",
        )
        chroma_storage.save(m)
        count = chroma_storage.transfer_working_to_episodic("session-test")
        assert count == 1

        # Should now be in episodic
        opts = ListOptions(level=MemoryLevel.episodic)
        episodic = chroma_storage.list(opts)
        assert len(episodic) == 1
        assert episodic[0].level == MemoryLevel.episodic

        # Should not be in working anymore
        working = chroma_storage.list(ListOptions(level=MemoryLevel.working))
        assert len(working) == 0

    def test_transfer_returns_count(self, chroma_storage: ChromaStorage) -> None:
        for i in range(3):
            m = make_memory(
                level=MemoryLevel.working,
                title=f"Working memory {i}",
                session_id="session-multi",
            )
            chroma_storage.save(m)
        count = chroma_storage.transfer_working_to_episodic("session-multi")
        assert count == 3

    def test_transfer_empty_session(self, chroma_storage: ChromaStorage) -> None:
        count = chroma_storage.transfer_working_to_episodic("nonexistent-session")
        assert count == 0


class TestStats:
    def test_stats_counts(self, chroma_storage: ChromaStorage) -> None:
        chroma_storage.save(make_memory(level=MemoryLevel.episodic, title="Episodic one"))
        chroma_storage.save(make_memory(level=MemoryLevel.semantic, title="Semantic one"))
        chroma_storage.save(make_memory(level=MemoryLevel.semantic, title="Semantic two"))
        stats = chroma_storage.stats()
        assert stats["episodic"] == 1
        assert stats["semantic"] == 2
        assert stats["working"] == 0
