"""Tests for MemoryService."""

from __future__ import annotations

import pytest

from cortex.memory.service import CreateInput, MemoryService
from cortex.models.memory import MemoryLevel
from cortex.storage.base import ListOptions, SearchOptions
from tests.conftest import MockEmbedder


class TestMemoryServiceCreate:
    def test_create_episodic(self, chroma_storage: object, mock_embedder: MockEmbedder) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        memory = svc.create(
            CreateInput(
                title="Auth bug fix",
                content="Fixed JWT token refresh by updating expiry to 24h.",
                level=MemoryLevel.episodic,
                tags=["auth", "jwt", "bug"],
            )
        )
        assert memory.id
        assert memory.title == "Auth bug fix"
        assert memory.level == MemoryLevel.episodic
        assert memory.embedding  # embedding was generated
        assert len(memory.embedding) == 768

    def test_create_working_requires_session(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="session_id"):
            svc.create(
                CreateInput(
                    title="Working memory",
                    content="Some in-progress context.",
                    level=MemoryLevel.working,
                )
            )

    def test_create_with_session(self, chroma_storage: object, mock_embedder: MockEmbedder) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        memory = svc.create(
            CreateInput(
                title="In-progress task",
                content="Working on auth refactor.",
                level=MemoryLevel.working,
                session_id="session-test",
            )
        )
        assert memory.context.session_id == "session-test"

    def test_embed_text_format(self) -> None:
        from cortex.models.memory import Memory

        m = Memory(
            level=MemoryLevel.episodic,
            title="Test Title",
            content="Test content here.",
            tags=["tag1", "tag2"],
        )
        text = MemoryService._embed_text(m)
        assert "Title: Test Title" in text
        assert "Content: Test content here." in text
        assert "Tags: tag1, tag2" in text


class TestMemoryServiceSearch:
    def test_search_returns_sorted_results(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        svc.create(
            CreateInput(
                title="JWT auth fix",
                content="Fixed authentication with JWT refresh tokens.",
                level=MemoryLevel.episodic,
                tags=["auth"],
            )
        )
        svc.create(
            CreateInput(
                title="Database connection pool",
                content="Configured connection pooling for PostgreSQL.",
                level=MemoryLevel.semantic,
                tags=["database"],
            )
        )
        results = svc.search("JWT authentication", SearchOptions(top_k=10, min_score=0.0))
        assert len(results) > 0
        # Results should be sorted by score descending
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_search_empty_returns_empty(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        results = svc.search("anything", SearchOptions(top_k=5, min_score=0.0))
        assert results == []


class TestMemoryServiceLifecycle:
    def test_mark_obsolete(self, chroma_storage: object, mock_embedder: MockEmbedder) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        memory = svc.create(
            CreateInput(
                title="Old pattern",
                content="This approach is now deprecated.",
                level=MemoryLevel.semantic,
            )
        )
        svc.mark_obsolete(memory.id)
        retrieved = svc.get(memory.id)
        assert retrieved.obsolete is True

    def test_transfer_working(self, chroma_storage: object, mock_embedder: MockEmbedder) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        svc.create(
            CreateInput(
                title="Session task",
                content="In-progress session work.",
                level=MemoryLevel.working,
                session_id="session-abc",
            )
        )
        count = svc.transfer_working("session-abc")
        assert count == 1

        # Should now be episodic
        episodic = svc.list(ListOptions(level=MemoryLevel.episodic))
        assert len(episodic) == 1


class TestMemoryServiceSaveContext:
    def test_create_stores_save_context_fields(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        memory = svc.create(
            CreateInput(
                title="Explicit branch memory",
                content="Created with explicit git branch metadata.",
                level=MemoryLevel.episodic,
                git_branch="feature/auth-refactor",
                agent_name="Claude",
                agent_session_id="agent-sess-123",
                user_prompt="Add auth refactor notes",
            )
        )
        # Fields must be persisted through storage
        retrieved = svc.get(memory.id)
        assert retrieved.context.git_branch == "feature/auth-refactor"
        assert retrieved.context.agent_name == "Claude"
        assert retrieved.context.agent_session_id == "agent-sess-123"
        assert retrieved.context.user_prompt == "Add auth refactor notes"

    def test_create_timestamp_is_unix_epoch(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        memory = svc.create(
            CreateInput(
                title="Timestamp test",
                content="Testing that timestamp is a unix epoch integer.",
                level=MemoryLevel.episodic,
            )
        )
        assert isinstance(memory.timestamp, int)
        assert memory.timestamp == int(memory.created_at.timestamp())

    def test_list_filters_by_git_branch(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        svc.create(
            CreateInput(
                title="Branch A memory",
                content="Stored on feature branch alpha.",
                level=MemoryLevel.episodic,
                git_branch="feature/alpha",
            )
        )
        svc.create(
            CreateInput(
                title="Branch B memory",
                content="Stored on feature branch beta.",
                level=MemoryLevel.episodic,
                git_branch="feature/beta",
            )
        )
        opts = ListOptions(git_branch="feature/alpha")
        results = svc.list(opts)
        assert len(results) == 1
        assert results[0].context.git_branch == "feature/alpha"
