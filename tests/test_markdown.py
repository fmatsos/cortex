"""Tests for Markdown import/export round-trips."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from cortex.markdown.export import export_memory
from cortex.markdown.import_ import ImportError, import_string
from cortex.models.memory import Memory, MemoryContext, MemoryLevel


def make_test_memory() -> Memory:
    return Memory(
        id="550e8400-e29b-41d4-a716-446655440000",
        level=MemoryLevel.semantic,
        title="Database timeout convention",
        content=(
            "All database queries must use context with a 30-second timeout."
            "\n\nThis prevents hung connections."
        ),
        tags=["convention", "database", "timeout"],
        context=MemoryContext(session_id="", source="manual"),
        created_at=datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC),
        updated_at=datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC),
    )


class TestExport:
    def test_export_has_frontmatter(self) -> None:
        m = make_test_memory()
        text = export_memory(m)
        assert "---" in text
        assert "id: 550e8400" in text
        assert "title: Database timeout convention" in text
        assert "level: semantic" in text
        assert "tags:" in text
        assert "convention" in text

    def test_export_has_content(self) -> None:
        m = make_test_memory()
        text = export_memory(m)
        assert "All database queries" in text

    def test_export_no_session_when_empty(self) -> None:
        m = make_test_memory()
        text = export_memory(m)
        assert "session_id" not in text

    def test_export_includes_session(self) -> None:
        m = make_test_memory()
        m.context.session_id = "session-abc"
        text = export_memory(m)
        assert "session_id: session-abc" in text

    def test_export_obsolete_flag(self) -> None:
        m = make_test_memory()
        m.obsolete = True
        text = export_memory(m)
        assert "obsolete: true" in text


class TestImport:
    def test_roundtrip(self) -> None:
        m = make_test_memory()
        exported = export_memory(m)
        imported = import_string(exported)
        assert imported.id == m.id
        assert imported.title == m.title
        assert imported.level == m.level
        assert imported.tags == m.tags
        # Content may differ slightly due to heading stripping
        assert "All database queries" in imported.content

    def test_import_minimal(self) -> None:
        text = """---
title: Test memory
level: episodic
---

This is the memory content with enough characters.
"""
        m = import_string(text)
        assert m.title == "Test memory"
        assert m.level == MemoryLevel.episodic
        assert "memory content" in m.content

    def test_import_missing_title_uses_content(self) -> None:
        text = """---
level: episodic
---

First line becomes the title here.
"""
        m = import_string(text)
        assert m.title  # title derived from content

    def test_import_invalid_level(self) -> None:
        text = """---
title: Test memory
level: invalid_level
---

Content here is long enough to pass validation.
"""
        with pytest.raises(ImportError, match="Invalid level"):
            import_string(text)

    def test_import_content_too_short(self) -> None:
        text = """---
title: Test memory
level: episodic
---

Short.
"""
        with pytest.raises(ImportError, match="Content too short"):
            import_string(text)

    def test_import_with_merged_from(self) -> None:
        text = """---
title: Merged memory
level: semantic
merged_from:
  - id-one
  - id-two
---

Long enough content for testing merged_from field.
"""
        m = import_string(text)
        assert "id-one" in m.merged_from
        assert "id-two" in m.merged_from
