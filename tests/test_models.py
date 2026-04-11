"""Tests for core memory domain models."""

from __future__ import annotations

import pytest

from cortex.models.memory import Memory, MemoryContext, MemoryLevel, MemorySource


class TestMemoryLevel:
    def test_valid_levels(self) -> None:
        assert MemoryLevel("working") == MemoryLevel.working
        assert MemoryLevel("episodic") == MemoryLevel.episodic
        assert MemoryLevel("semantic") == MemoryLevel.semantic

    def test_invalid_level(self) -> None:
        with pytest.raises(ValueError):
            MemoryLevel("invalid")


class TestMemoryValidation:
    def test_title_too_short(self) -> None:
        with pytest.raises(ValueError, match="at least 3"):
            Memory(level=MemoryLevel.episodic, title="ab", content="This is valid content here.")

    def test_title_too_long(self) -> None:
        with pytest.raises(ValueError, match="at most 60"):
            Memory(level=MemoryLevel.episodic, title="x" * 61, content="Valid content here.")

    def test_content_too_short(self) -> None:
        with pytest.raises(ValueError, match="at least 10"):
            Memory(level=MemoryLevel.episodic, title="Valid title", content="short")

    def test_working_requires_session(self) -> None:
        with pytest.raises(ValueError, match="session_id"):
            Memory(level=MemoryLevel.working, title="Valid title", content="Valid content here.")

    def test_working_with_session(self) -> None:
        m = Memory(
            level=MemoryLevel.working,
            title="Valid title",
            content="Valid content here.",
            context=MemoryContext(session_id="session-123"),
        )
        assert m.context.session_id == "session-123"

    def test_valid_memory(self) -> None:
        m = Memory(
            level=MemoryLevel.episodic,
            title="Bug fix: auth timeout",
            content="Fixed the auth timeout by increasing the JWT expiry to 24h.",
        )
        assert m.id  # UUID auto-generated
        assert m.created_at
        assert m.updated_at
        assert not m.obsolete
        assert m.tags == []

    def test_id_auto_generated(self) -> None:
        m1 = Memory(level=MemoryLevel.semantic, title="Test title", content="Test content here.")
        m2 = Memory(level=MemoryLevel.semantic, title="Test title", content="Test content here.")
        assert m1.id != m2.id

    def test_title_stripped(self) -> None:
        m = Memory(
            level=MemoryLevel.episodic, title="  Valid title  ", content="Valid content here."
        )
        assert m.title == "Valid title"


class TestMemoryDeriveTitle:
    def test_derive_from_content(self) -> None:
        title = Memory.derive_title("Fix the auth bug in the JWT module")
        assert len(title) <= 60
        assert title

    def test_derive_caps_at_60(self) -> None:
        long_content = "A" * 100
        title = Memory.derive_title(long_content)
        assert len(title) <= 60

    def test_derive_from_first_line(self) -> None:
        content = "First line is the title\nSecond line."
        title = Memory.derive_title(content)
        assert "First line" in title


class TestMemoryContext:
    def test_defaults(self) -> None:
        ctx = MemoryContext()
        assert ctx.session_id == ""
        assert ctx.task_id == ""
        assert ctx.source == MemorySource.manual
        assert ctx.related_memories == []
        # Save-context fields default to empty
        assert ctx.git_branch == ""
        assert ctx.agent_name == ""
        assert ctx.agent_session_id == ""
        assert ctx.user_prompt == ""

    def test_source_validation(self) -> None:
        ctx = MemoryContext(source=MemorySource.llm)
        assert ctx.source == "llm"

    def test_invalid_source(self) -> None:
        with pytest.raises(ValueError):
            MemoryContext(source="invalid")  # type: ignore[arg-type]

    def test_save_context_fields(self) -> None:
        ctx = MemoryContext(
            git_branch="feature/my-branch",
            agent_name="claude",
            agent_session_id="sess-123",
            user_prompt="help me fix this bug",
        )
        assert ctx.git_branch == "feature/my-branch"
        assert ctx.agent_name == "claude"
        assert ctx.agent_session_id == "sess-123"
        assert ctx.user_prompt == "help me fix this bug"
