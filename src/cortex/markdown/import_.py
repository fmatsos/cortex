"""Import Cortex memories from Markdown files with YAML frontmatter."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import frontmatter

from cortex.models.memory import Memory, MemoryContext, MemoryLevel


class ImportError(Exception):
    """Raised when a Markdown file cannot be imported."""


def import_string(content: str, source_name: str = "<string>") -> Memory:
    """Parse a Markdown string with YAML frontmatter into a Memory.

    Raises ImportError if the content is invalid.
    """
    try:
        post = frontmatter.loads(content)
    except Exception as exc:
        raise ImportError(f"Failed to parse frontmatter in {source_name}: {exc}") from exc

    meta = post.metadata
    body = post.content.strip()

    # Strip leading "# Title" heading if present
    lines = body.splitlines()
    if lines and lines[0].startswith("# "):
        body = "\n".join(lines[1:]).strip()

    title = str(meta.get("title", ""))
    if not title:
        # Derive from first heading or content
        first_line = (body.splitlines() or [""])[0][:60].strip()
        title = first_line or "Memory"

    if len(title) < 3:
        raise ImportError(f"Title too short (min 3 chars) in {source_name}")
    if len(body) < 10:
        raise ImportError(f"Content too short (min 10 chars) in {source_name}")

    raw_level = str(meta.get("level", "episodic"))
    try:
        level = MemoryLevel(raw_level)
    except ValueError:
        raise ImportError(f"Invalid level {raw_level!r} in {source_name}") from None

    tags = _parse_list(meta.get("tags", []))
    merged_from = _parse_list(meta.get("merged_from", []))
    session_id = str(meta.get("session_id", ""))
    obsolete = bool(meta.get("obsolete", False))
    memory_id = str(meta.get("id", "")) or str(uuid4())

    created_at = _parse_dt(meta.get("created_at"))
    updated_at = _parse_dt(meta.get("updated_at"))

    context = MemoryContext(
        session_id=session_id,
        source="manual",
    )

    return Memory(
        id=memory_id,
        level=level,
        title=title,
        content=body,
        tags=tags,
        context=context,
        created_at=created_at,
        updated_at=updated_at,
        merged_from=merged_from,
        obsolete=obsolete,
    )


def import_file(path: Path | str) -> Memory:
    """Read a Markdown file and parse it as a Memory."""
    p = Path(path)
    if not p.exists():
        raise ImportError(f"File not found: {p}")
    content = p.read_text(encoding="utf-8")
    return import_string(content, source_name=str(p))


def import_files(paths: list[Path | str]) -> list[tuple[Memory, Exception | None]]:
    """Import multiple Markdown files, returning (Memory, error) pairs."""
    results: list[tuple[Memory, Exception | None]] = []
    for path in paths:
        try:
            memory = import_file(path)
            results.append((memory, None))
        except Exception as exc:
            results.append((Memory.__new__(Memory), exc))  # type: ignore[arg-type]
    return results


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _parse_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str) and value:
        return [v.strip() for v in value.split(",") if v.strip()]
    return []


def _parse_dt(value: object) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            pass
    return datetime.now(UTC)
