"""Tests for ConsolidationService."""

from __future__ import annotations

from cortex.consolidation.service import ConsolidateInput, ConsolidationService
from cortex.memory.service import CreateInput, MemoryService
from cortex.models.memory import MemoryLevel
from tests.conftest import MockEmbedder


class TestConsolidation:
    def _make_svc(
        self, chroma_storage: object, mock_embedder: MockEmbedder, threshold: float = 0.85
    ) -> ConsolidationService:
        return ConsolidationService(
            storage=chroma_storage,  # type: ignore[arg-type]
            embedder=mock_embedder,
            similarity_threshold=threshold,
        )

    def test_creates_new_when_no_similar(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = self._make_svc(chroma_storage, mock_embedder)
        result = svc.consolidate(
            ConsolidateInput(
                synthesis="JWT token refresh implementation details.",
                level=MemoryLevel.semantic,
                title="JWT refresh",
            )
        )
        assert result.action == "created"
        assert result.memory_id

    def test_merges_when_similar_exists(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        # Use threshold=0.0 to force merge with any existing memory
        svc = self._make_svc(chroma_storage, mock_embedder, threshold=0.0)

        # Create an initial memory
        mem_svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        existing = mem_svc.create(
            CreateInput(
                title="JWT token refresh",
                content="Initial JWT token refresh implementation.",
                level=MemoryLevel.semantic,
                tags=["jwt", "auth"],
            )
        )

        # Consolidate similar content
        result = svc.consolidate(
            ConsolidateInput(
                synthesis="Additional JWT token refresh details.",
                level=MemoryLevel.semantic,
                title="JWT refresh update",
            )
        )
        assert result.action == "merged"
        assert result.memory_id == existing.id

        # Check merged content contains separator
        merged = mem_svc.get(existing.id)
        assert "---" in merged.content

    def test_force_always_creates(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        svc = self._make_svc(chroma_storage, mock_embedder, threshold=0.0)

        # Create initial
        mem_svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]
        mem_svc.create(
            CreateInput(
                title="Pattern A",
                content="Some existing pattern details.",
                level=MemoryLevel.semantic,
            )
        )

        # Force create — should NOT merge
        result = svc.consolidate(
            ConsolidateInput(
                synthesis="Some existing pattern details.",
                level=MemoryLevel.semantic,
                force=True,
            )
        )
        assert result.action == "created"

    def test_promote_to_semantic(self, chroma_storage: object, mock_embedder: MockEmbedder) -> None:
        svc = self._make_svc(chroma_storage, mock_embedder)
        mem_svc = MemoryService(chroma_storage, mock_embedder)  # type: ignore[arg-type]

        episodic = mem_svc.create(
            CreateInput(
                title="Pattern discovered in session",
                content="This pattern should be promoted to semantic.",
                level=MemoryLevel.episodic,
            )
        )

        promoted = svc.promote_to_semantic(episodic.id)
        assert promoted.level == MemoryLevel.semantic
        assert episodic.id in promoted.merged_from

        # Original should be obsolete
        original = mem_svc.get(episodic.id)
        assert original.obsolete

    def test_consolidate_stores_save_context_fields(
        self, chroma_storage: object, mock_embedder: MockEmbedder
    ) -> None:
        """PR #38: save-context fields are persisted via consolidation path."""
        svc = self._make_svc(chroma_storage, mock_embedder)
        result = svc.consolidate(
            ConsolidateInput(
                synthesis="Testing context fields in consolidation path.",
                level=MemoryLevel.semantic,
                git_branch="feature/ctx-test",
                agent_name="test-agent",
                agent_session_id="agent-sess-999",
                user_prompt="consolidate this",
                force=True,
            )
        )
        assert result.action == "created"

        # Reload and verify
        from cortex.storage.base import ListOptions

        memories = chroma_storage.list(  # type: ignore[attr-defined]
            ListOptions(level=MemoryLevel.semantic)
        )
        assert len(memories) == 1
        ctx = memories[0].context
        assert ctx.git_branch == "feature/ctx-test"
        assert ctx.agent_name == "test-agent"
        assert ctx.agent_session_id == "agent-sess-999"
        assert ctx.user_prompt == "consolidate this"

    def test_consolidate_auto_detects_git_branch(
        self,
        chroma_storage: object,
        mock_embedder: MockEmbedder,
        monkeypatch: object,
    ) -> None:
        """PR #38/#39: git_branch is auto-detected in consolidation when omitted."""
        import pytest

        mp = pytest.MonkeyPatch()
        mp.setattr("cortex.session._get_git_branch", lambda: "auto-branch-consolidate")
        try:
            svc = self._make_svc(chroma_storage, mock_embedder)
            result = svc.consolidate(
                ConsolidateInput(
                    synthesis="Auto git-branch detection in consolidation service.",
                    level=MemoryLevel.semantic,
                    force=True,
                )
            )
            from cortex.storage.base import ListOptions

            memories = chroma_storage.list(  # type: ignore[attr-defined]
                ListOptions(level=MemoryLevel.semantic)
            )
            assert len(memories) == 1
            assert memories[0].context.git_branch == "auto-branch-consolidate"
            assert result.action == "created"
        finally:
            mp.undo()
