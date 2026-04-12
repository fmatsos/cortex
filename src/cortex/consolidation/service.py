"""Consolidation service — create or merge memories with deduplication."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

import numpy as np

from cortex.embeddings.base import Embedder
from cortex.memory.service import MemoryService
from cortex.models.memory import Memory, MemoryContext, MemoryLevel, MemorySource
from cortex.models.results import ConsolidateResult
from cortex.search.cosine import normalize
from cortex.session import get_git_branch
from cortex.storage.base import SearchOptions, Storage
from cortex.utils import dedupe_list

_MERGE_SEPARATOR = "\n\n---\n\n"


@dataclass
class ConsolidateInput:
    """Input parameters for a consolidation operation."""

    synthesis: str  # Content to consolidate (becomes new/merged content)
    level: MemoryLevel
    title: str = ""
    tags: list[str] = field(default_factory=list)
    session_id: str = ""
    source: MemorySource = MemorySource.manual
    task_id: str = ""
    author: str = ""
    force: bool = False  # Skip duplicate detection when True
    # Save-context fields (PR #38)
    git_branch: str = ""
    agent_name: str = ""
    agent_session_id: str = ""
    user_prompt: str = ""


class ConsolidationService:
    """Creates or merges memories based on semantic similarity.

    When *force* is False (default):
    - Embeds the incoming synthesis
    - Searches for similar memories at the target level (threshold configurable, default 0.85)
    - If a match is found: merges content, updates embedding, preserves lineage
    - If no match: creates a new memory

    When *force* is True: always creates a new memory.
    """

    def __init__(
        self,
        storage: Storage,
        embedder: Embedder,
        similarity_threshold: float = 0.85,
    ) -> None:
        self._storage = storage
        self._embedder = embedder
        self._threshold = similarity_threshold

    def consolidate(self, inp: ConsolidateInput) -> ConsolidateResult:
        """Run the consolidation logic and return a result."""
        embed_text = MemoryService.EMBED_TEXT_TEMPLATE.format(
            title=inp.title or inp.synthesis[:60],
            content=inp.synthesis,
            tags=", ".join(inp.tags),
        )
        vector = self._embedder.embed(embed_text)

        if not inp.force:
            similar = self._find_similar(vector, inp.level, inp.session_id)
            if similar:
                existing, score = similar
                merged = self._merge(existing, inp, vector)
                return ConsolidateResult(
                    action="merged",
                    memory_id=merged.id,
                    level=str(merged.level),
                    similarity=score,
                    message=f"Merged with existing memory (score={score:.3f})",
                )

        # Create new memory
        # Auto-detect git branch when not explicitly provided (PR #38/#39)
        git_branch = inp.git_branch or get_git_branch()

        context = MemoryContext(
            session_id=inp.session_id,
            task_id=inp.task_id,
            author=inp.author,
            source=inp.source,
            timestamp=datetime.now(UTC),
            git_branch=git_branch,
            agent_name=inp.agent_name,
            agent_session_id=inp.agent_session_id,
            user_prompt=inp.user_prompt,
        )
        title = inp.title or Memory.derive_title(inp.synthesis)
        memory = Memory(
            id=str(uuid4()),
            level=inp.level,
            title=title,
            content=inp.synthesis,
            tags=inp.tags,
            embedding=vector,
            context=context,
        )
        self._storage.save(memory)
        return ConsolidateResult(
            action="created",
            memory_id=memory.id,
            level=str(memory.level),
            message="Created new memory",
        )

    def promote_to_semantic(self, memory_id: str) -> Memory:
        """Move an episodic memory to semantic, assigning a new ID and tracking origin."""
        source = self._storage.get(memory_id)
        # get() does not return the stored embedding; fetch it separately so the
        # promoted memory carries over the correct vector.
        embedding = self._storage.get_embedding(memory_id)
        new_memory = Memory(
            id=str(uuid4()),
            level=MemoryLevel.semantic,
            title=source.title,
            content=source.content,
            tags=source.tags,
            embedding=embedding,
            context=source.context,
            merged_from=[source.id],
        )
        self._storage.save(new_memory)
        # Mark the original as obsolete
        source.obsolete = True
        source.touch()
        self._storage.update(source)
        return new_memory

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_similar(
        self,
        vector: list[float],
        level: MemoryLevel,
        session_id: str,
    ) -> tuple[Memory, float] | None:
        """Return the most similar non-obsolete memory above threshold, or None."""
        opts = SearchOptions(
            top_k=1,
            min_score=self._threshold,
            filter_levels=[level],
            include_obsolete=False,
            session_id=session_id,
        )
        results = self._storage.search_all_layers(vector, opts)
        if results:
            return results[0].memory, results[0].score
        return None

    def _merge(self, existing: Memory, inp: ConsolidateInput, new_vector: list[float]) -> Memory:
        """Merge new content into an existing memory."""
        existing.content = existing.content + _MERGE_SEPARATOR + inp.synthesis
        existing.tags = dedupe_list(existing.tags + inp.tags)
        existing.merged_from = dedupe_list(existing.merged_from)
        existing.touch()

        # Average embeddings (fetch stored embedding since deserialized embedding is always [])
        stored_embedding = self._storage.get_embedding(existing.id)
        if stored_embedding and new_vector:
            averaged = np.mean([stored_embedding, new_vector], axis=0).tolist()
            existing.embedding = normalize(averaged)

        self._storage.update(existing)
        return existing
