"""Export Cortex memories to Markdown with YAML frontmatter."""

from __future__ import annotations

from cortex.models.memory import Memory

_DATE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def export_memory(memory: Memory) -> str:
    """Render a single Memory as a Markdown string with YAML frontmatter."""
    tags_yaml = _yaml_list(memory.tags)
    created = memory.created_at.strftime(_DATE_FORMAT)
    updated = memory.updated_at.strftime(_DATE_FORMAT)

    lines = [
        "---",
        f"id: {memory.id}",
        f"title: {memory.title}",
        f"level: {memory.level if isinstance(memory.level, str) else memory.level.value}",
        f"tags:{tags_yaml}",
        f"created_at: {created}",
        f"updated_at: {updated}",
    ]

    if memory.obsolete:
        lines.append("obsolete: true")

    session_id = memory.context.session_id
    if session_id:
        lines.append(f"session_id: {session_id}")

    if memory.merged_from:
        lines.append(f"merged_from:{_yaml_list(memory.merged_from)}")

    lines += ["---", "", f"# {memory.title}", "", memory.content]
    return "\n".join(lines) + "\n"


def export_memories(memories: list[Memory]) -> str:
    """Render multiple memories as a single Markdown document."""
    sections = [export_memory(m) for m in memories]
    return "\n---\n\n".join(sections)


def _yaml_list(items: list[str]) -> str:
    """Format a list for inline YAML frontmatter."""
    if not items:
        return " []"
    formatted = "\n".join(f"  - {item}" for item in items)
    return f"\n{formatted}"
