"""ChromaDB storage backend for Cortex.

Three persistent collections, one per memory level:
  cortex_working   — working memories (session-scoped, temporary)
  cortex_episodic  — episodic memories (time-bound, 90-day default retention)
  cortex_semantic  — semantic memories (permanent knowledge)

ChromaDB metadata only supports str/int/float/bool.
Lists (tags, merged_from, etc.) are JSON-serialized to strings.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import chromadb
from chromadb.api.models.Collection import Collection

from cortex.models.memory import Memory, MemoryContext, MemoryLevel, MemorySource
from cortex.models.results import SearchResult
from cortex.storage.base import ListOptions, SearchOptions

_COLLECTION_PREFIX = "cortex_"
_LEVELS = [MemoryLevel.working, MemoryLevel.episodic, MemoryLevel.semantic]


def _col_name(level: MemoryLevel) -> str:
    return f"{_COLLECTION_PREFIX}{level.value}"


def _meta_to_dict(memory: Memory) -> dict[str, Any]:
    """Serialize Memory fields to a flat Chroma-compatible metadata dict."""
    return {
        "title": memory.title,
        "level": memory.level if isinstance(memory.level, str) else memory.level.value,
        "tags": json.dumps(memory.tags),
        "session_id": memory.context.session_id or "",
        "task_id": memory.context.task_id or "",
        "author": memory.context.author or "",
        "source": (
            memory.context.source
            if isinstance(memory.context.source, str)
            else memory.context.source.value
        ),
        "ctx_tags": json.dumps(memory.context.tags),
        "related_memories": json.dumps(memory.context.related_memories),
        "created_at": memory.created_at.isoformat(),
        "updated_at": memory.updated_at.isoformat(),
        "merged_from": json.dumps(memory.merged_from),
        "obsolete": memory.obsolete,
    }


def _dict_to_memory(
    memory_id: str,
    document: str,
    metadata: dict[str, Any],
) -> Memory:
    """Reconstruct a Memory from Chroma storage."""

    def _dt(val: str) -> datetime:
        dt = datetime.fromisoformat(val)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt

    context = MemoryContext(
        session_id=metadata.get("session_id", ""),
        task_id=metadata.get("task_id", ""),
        author=metadata.get("author", ""),
        source=MemorySource(metadata.get("source", "manual")),
        tags=json.loads(metadata.get("ctx_tags", "[]")),
        related_memories=json.loads(metadata.get("related_memories", "[]")),
        timestamp=_dt(metadata.get("created_at", datetime.now(UTC).isoformat())),
    )

    return Memory(
        id=memory_id,
        level=MemoryLevel(metadata["level"]),
        title=metadata["title"],
        content=document,
        tags=json.loads(metadata.get("tags", "[]")),
        embedding=[],  # embeddings not stored in metadata; managed by Chroma
        context=context,
        created_at=_dt(metadata["created_at"]),
        updated_at=_dt(metadata["updated_at"]),
        merged_from=json.loads(metadata.get("merged_from", "[]")),
        obsolete=bool(metadata.get("obsolete", False)),
    )


class ChromaStorage:
    """ChromaDB-backed storage for the three-layer Cortex memory system."""

    def __init__(self, path: str) -> None:
        self._client = chromadb.PersistentClient(path=path)
        self._collections: dict[str, Collection] = {
            level.value: self._client.get_or_create_collection(
                name=_col_name(level),
                metadata={"hnsw:space": "cosine"},
            )
            for level in _LEVELS
        }

    def _col(self, level: MemoryLevel | str) -> Collection:
        key = level if isinstance(level, str) else level.value
        return self._collections[key]

    # ------------------------------------------------------------------
    # Core CRUD
    # ------------------------------------------------------------------

    def save(self, memory: Memory) -> None:
        level = memory.level if isinstance(memory.level, str) else memory.level.value
        col = self._col(level)
        embedding = memory.embedding if memory.embedding else None
        col.add(
            ids=[memory.id],
            embeddings=[embedding] if embedding else None,
            documents=[memory.content],
            metadatas=[_meta_to_dict(memory)],
        )

    def get(self, memory_id: str) -> Memory:
        """Retrieve by exact ID or unique prefix."""
        for level in _LEVELS:
            col = self._col(level)
            # Try exact match first
            result = col.get(ids=[memory_id], include=["documents", "metadatas"])
            if result["ids"]:
                return _dict_to_memory(
                    result["ids"][0],
                    result["documents"][0],
                    result["metadatas"][0],
                )

        # Prefix matching across all collections
        return self._get_by_prefix(memory_id)

    def _get_by_prefix(self, prefix: str) -> Memory:
        matches: list[tuple[str, MemoryLevel]] = []
        for level in _LEVELS:
            col = self._col(level)
            all_ids_result = col.get(include=[])
            for mid in all_ids_result["ids"]:
                if mid.startswith(prefix):
                    matches.append((mid, level))

        if not matches:
            raise KeyError(f"Memory not found: {prefix!r}")
        if len(matches) > 1:
            ids = [m[0] for m in matches]
            raise ValueError(f"Ambiguous ID prefix {prefix!r} matches: {ids}")

        found_id, found_level = matches[0]
        col = self._col(found_level)
        result = col.get(ids=[found_id], include=["documents", "metadatas"])
        return _dict_to_memory(result["ids"][0], result["documents"][0], result["metadatas"][0])

    def list(self, opts: ListOptions | None = None) -> list[Memory]:
        opts = opts or ListOptions()
        levels = [opts.level] if opts.level else list(_LEVELS)

        memories: list[Memory] = []
        for level in levels:
            col = self._col(level)
            result = col.get(include=["documents", "metadatas"])
            for mid, doc, meta in zip(
                result["ids"], result["documents"], result["metadatas"], strict=False
            ):
                m = _dict_to_memory(mid, doc, meta)
                if not opts.include_obsolete and m.obsolete:
                    continue
                if opts.session_id and m.context.session_id != opts.session_id:
                    continue
                memories.append(m)

        memories.sort(key=lambda m: m.created_at, reverse=not opts.reverse)

        if opts.offset:
            memories = memories[opts.offset :]
        if opts.limit:
            memories = memories[: opts.limit]

        return memories

    def delete(self, memory_id: str) -> None:
        for level in _LEVELS:
            col = self._col(level)
            result = col.get(ids=[memory_id], include=[])
            if result["ids"]:
                col.delete(ids=[memory_id])
                return
        raise KeyError(f"Memory not found: {memory_id!r}")

    def update(self, memory: Memory) -> None:
        level = memory.level if isinstance(memory.level, str) else memory.level.value

        # Find which collection currently holds this memory and retrieve its
        # existing embedding so we can carry it forward without triggering
        # Chroma's default 384-dim re-embedding.
        current_level: MemoryLevel | None = None
        old_embedding: list[float] | None = None
        for lvl in _LEVELS:
            col = self._col(lvl)
            result = col.get(ids=[memory.id], include=["embeddings"])
            if result["ids"]:
                current_level = lvl
                raw = result["embeddings"]
                if raw is not None and len(raw) > 0 and raw[0] is not None:
                    old_embedding = list(raw[0])
                break

        if current_level is None:
            raise KeyError(f"Memory not found: {memory.id!r}")

        # Prefer a freshly computed embedding on the memory object; fall back to
        # the existing stored embedding so we never trigger Chroma's auto-embed.
        embedding: list[float] | None = memory.embedding if memory.embedding else old_embedding

        target_col = self._col(level)

        if current_level.value == level:
            # Same collection — update in place.
            target_col.update(
                ids=[memory.id],
                embeddings=[embedding] if embedding else None,
                documents=[memory.content],
                metadatas=[_meta_to_dict(memory)],
            )
        else:
            # Level changed — delete from old collection, add to new.
            self._col(current_level).delete(ids=[memory.id])
            target_col.add(
                ids=[memory.id],
                embeddings=[embedding] if embedding else None,
                documents=[memory.content],
                metadatas=[_meta_to_dict(memory)],
            )

    # ------------------------------------------------------------------
    # Semantic search
    # ------------------------------------------------------------------

    def search_all_layers(
        self,
        vector: list[float],
        opts: SearchOptions | None = None,
    ) -> list[SearchResult]:
        opts = opts or SearchOptions()
        levels = opts.filter_levels if opts.filter_levels else list(_LEVELS)

        # For working-level search, filter by session_id
        results: list[SearchResult] = []

        for level in levels:
            col = self._col(level)
            try:
                n = max(opts.top_k, 10)  # fetch more to allow filtering
                where: dict[str, Any] | None = None

                if not opts.include_obsolete:
                    where = {"obsolete": False}

                if level == MemoryLevel.working and opts.session_id:
                    session_filter: dict[str, Any] = {"session_id": opts.session_id}
                    where = {"$and": [where, session_filter]} if where else session_filter

                query_result = col.query(
                    query_embeddings=[vector],
                    n_results=min(n, max(col.count(), 1)),
                    where=where,
                    include=["documents", "metadatas", "distances"],
                )

                ids = query_result["ids"][0]
                docs = query_result["documents"][0]
                metas = query_result["metadatas"][0]
                distances = query_result["distances"][0]

                for mid, doc, meta, dist in zip(ids, docs, metas, distances, strict=False):
                    # ChromaDB cosine distance = 1 - similarity; clamp to [0, 1]
                    score = max(0.0, 1.0 - dist)
                    if score < opts.min_score:
                        continue
                    m = _dict_to_memory(mid, doc, meta)
                    results.append(SearchResult(memory=m, score=score))

            except Exception:
                # Empty collection or other non-fatal error — skip this level
                pass

        results.sort(key=lambda r: r.score, reverse=True)
        return results[: opts.top_k]

    def search_by_vector(
        self,
        vector: list[float],
        level: MemoryLevel,
        top_k: int = 10,
        min_score: float = 0.0,
        include_obsolete: bool = True,
        session_id: str = "",
    ) -> list[SearchResult]:
        """Search within a single level collection.

        Used internally by consolidation and autoprune services.
        """
        col = self._col(level)
        count = col.count()
        if count == 0:
            return []

        where: dict[str, Any] | None = None
        if not include_obsolete:
            where = {"obsolete": False}

        if level == MemoryLevel.working and session_id:
            sf: dict[str, Any] = {"session_id": session_id}
            where = {"$and": [where, sf]} if where else sf

        query_result = col.query(
            query_embeddings=[vector],
            n_results=min(top_k, count),
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        results: list[SearchResult] = []
        ids = query_result["ids"][0]
        docs = query_result["documents"][0]
        metas = query_result["metadatas"][0]
        distances = query_result["distances"][0]

        for mid, doc, meta, dist in zip(ids, docs, metas, distances, strict=False):
            score = max(0.0, 1.0 - dist)
            if score < min_score:
                continue
            m = _dict_to_memory(mid, doc, meta)
            results.append(SearchResult(memory=m, score=score))

        return results

    def get_embedding(self, memory_id: str) -> list[float]:
        """Fetch the raw stored embedding for a single memory.

        Returns an empty list if the memory has no embedding or is not found.
        """
        for level in _LEVELS:
            col = self._col(level)
            result = col.get(ids=[memory_id], include=["embeddings"])
            if result["ids"]:
                raw = result["embeddings"]
                if raw is not None and len(raw) > 0 and raw[0] is not None:
                    return list(raw[0])
                return []
        return []

    def get_all_with_embeddings(self, level: MemoryLevel) -> list[tuple[Memory, list[float]]]:
        """Retrieve all memories and their raw embeddings for a given level.

        Used by autoprune for pairwise similarity comparison.
        """
        col = self._col(level)
        result = col.get(include=["documents", "metadatas", "embeddings"])

        out: list[tuple[Memory, list[float]]] = []
        for mid, doc, meta, emb in zip(
            result["ids"],
            result["documents"],
            result["metadatas"],
            result["embeddings"],
            strict=False,
        ):
            m = _dict_to_memory(mid, doc, meta)
            out.append((m, list(emb) if emb is not None else []))
        return out

    # ------------------------------------------------------------------
    # Working memory transfer
    # ------------------------------------------------------------------

    def transfer_working_to_episodic(self, session_id: str) -> int:
        """Promote all working memories for a session to episodic layer."""
        working_col = self._col(MemoryLevel.working)
        episodic_col = self._col(MemoryLevel.episodic)

        where: dict[str, Any] = {"session_id": session_id}
        result = working_col.get(where=where, include=["documents", "metadatas", "embeddings"])

        if not result["ids"]:
            return 0

        now = datetime.now(UTC).isoformat()
        new_metas: list[dict[str, Any]] = []
        new_embeddings: list[list[float] | None] = []

        for meta, emb in zip(result["metadatas"], result["embeddings"], strict=False):
            updated_meta = dict(meta)
            updated_meta["level"] = MemoryLevel.episodic.value
            updated_meta["updated_at"] = now
            new_metas.append(updated_meta)
            new_embeddings.append(list(emb) if emb is not None else None)

        # Only pass embeddings when ALL memories have one; otherwise omit to
        # avoid partial dimension mismatches.
        all_embeddings = [e for e in new_embeddings if e is not None]
        embeddings_arg = all_embeddings if len(all_embeddings) == len(result["ids"]) else None
        episodic_col.add(
            ids=result["ids"],
            embeddings=embeddings_arg,
            documents=result["documents"],
            metadatas=new_metas,
        )

        working_col.delete(ids=result["ids"])
        return len(result["ids"])

    def stats(self) -> dict[str, int]:
        """Return counts per memory level."""
        return {level.value: self._col(level).count() for level in _LEVELS}

    def close(self) -> None:
        """No-op — ChromaDB manages its own connection lifecycle."""
