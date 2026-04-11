"""Memory quality scoring - rates completeness and richness of a memory."""

from __future__ import annotations

from cortex.models.memory import Memory


def quality_score(memory: Memory) -> float:
    """Score a memory's quality from 0.0 to 1.0.

    Factors (each contributes up to 0.25):
    - Content length: longer content is richer (capped at 500 chars)
    - Explicit title: title not derived from content
    - Tag count: more tags improve discoverability (capped at 5)
    - Context completeness: session_id, author, task_id, source filled
    """
    score = 0.0

    # Content length (0.0 - 0.25)
    content_len = len(memory.content.strip())
    score += min(content_len / 500.0, 1.0) * 0.25

    # Explicit title (0.0 or 0.25)
    title_is_explicit = not memory.content.strip().startswith(memory.title)
    score += 0.25 if title_is_explicit else 0.0

    # Tag count (0.0 - 0.25)
    tag_count = len(memory.tags)
    score += min(tag_count / 5.0, 1.0) * 0.25

    # Context completeness (0.0 - 0.25)
    ctx = memory.context
    filled = sum(1 for v in [ctx.session_id, ctx.author, ctx.task_id] if v)
    score += (filled / 3.0) * 0.25

    return round(min(score, 1.0), 3)
