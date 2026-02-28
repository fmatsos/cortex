#!/usr/bin/env python3
"""Cortex zvec sidecar server.

Provides an HTTP REST API wrapping the zvec vector database for use as a
Cortex storage backend. Cortex launches this process automatically when
``storage.backend = zvec`` is configured.

Usage:
    python3 zvec-server.py --port 8765 --data-dir /path/to/data --dimension 768

Requirements:
    pip install zvec fastapi uvicorn
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from contextlib import asynccontextmanager
from typing import Any, Optional

# Check required packages before importing them.
_MISSING: list[str] = []
for _pkg in ("fastapi", "uvicorn", "zvec"):
    try:
        __import__(_pkg)
    except ImportError:
        _MISSING.append(_pkg)

if _MISSING:
    print(
        f"ERROR: missing packages: {', '.join(_MISSING)}. "
        f"Install with: pip install {' '.join(_MISSING)}",
        file=sys.stderr,
    )
    sys.exit(1)

import uvicorn  # noqa: E402
import zvec  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
_DATA_DIR: str = ""
_DIMENSION: int = 768
_LOCK = threading.Lock()

_persistent_collection: Optional[zvec.Collection] = None
_persistent_data: dict[str, Any] = {}  # id -> memory dict (includes "embedding")
_persistent_meta_path: str = ""

_working_collections: dict[str, zvec.Collection] = {}  # session_id -> collection
_working_data: dict[str, dict[str, Any]] = {}  # session_id -> {id -> memory dict}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_or_create_collection(path: str, name: str, dimension: int) -> zvec.Collection:
    """Opens an existing zvec collection or creates a new one."""
    if os.path.exists(path):
        return zvec.open(path=path)
    schema = zvec.CollectionSchema(
        name=name,
        vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, dimension),
    )
    return zvec.create_and_open(path=path, schema=schema)


def _load_meta(path: str) -> dict[str, Any]:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def _flush_meta(path: str, data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)


def _upsert_vector(collection: zvec.Collection, memory_id: str, embedding: list[float]) -> None:
    """Upserts a vector into the collection if embedding is non-empty."""
    if embedding:
        doc = zvec.Doc(id=memory_id, vectors={"embedding": embedding})
        collection.upsert(doc)


def _get_embedding_from_collection(
    collection: zvec.Collection, memory_id: str
) -> list[float]:
    """Retrieves the embedding for a given memory ID from a zvec collection."""
    docs = collection.fetch([memory_id])
    if memory_id in docs:
        vec = docs[memory_id].vector("embedding")
        if vec is not None:
            return list(vec)
    return []


# ---------------------------------------------------------------------------
# Lifespan / startup
# ---------------------------------------------------------------------------

def _init_storage(data_dir: str, dimension: int) -> None:
    global _persistent_collection, _persistent_data, _persistent_meta_path
    global _DATA_DIR, _DIMENSION

    _DATA_DIR = data_dir
    _DIMENSION = dimension

    os.makedirs(data_dir, exist_ok=True)
    working_dir = os.path.join(data_dir, "working")
    os.makedirs(working_dir, exist_ok=True)

    _persistent_meta_path = os.path.join(data_dir, "memories.json")
    persistent_coll_path = os.path.join(data_dir, "persistent.zvec")

    _persistent_data.update(_load_meta(_persistent_meta_path))
    _persistent_collection = _open_or_create_collection(
        persistent_coll_path, "persistent", dimension
    )

    # Load existing working sessions.
    for fname in os.listdir(working_dir):
        if not fname.endswith(".json"):
            continue
        session_id = fname[: -len(".json")]
        _working_data[session_id] = _load_meta(os.path.join(working_dir, fname))
        coll_path = os.path.join(working_dir, f"{session_id}.zvec")
        if os.path.exists(coll_path):
            _working_collections[session_id] = _open_or_create_collection(
                coll_path, f"working-{session_id}", dimension
            )


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Startup is handled before uvicorn via _init_storage().
    yield


app = FastAPI(lifespan=_lifespan)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class MemoryPayload(BaseModel):
    id: str
    level: str  # working | episodic | semantic
    embedding: list[float] = []
    session_id: Optional[str] = None
    data: dict[str, Any]  # full memory dict (may include "embedding" key)


class UpdatePayload(BaseModel):
    id: str
    level: str
    embedding: list[float] = []
    session_id: Optional[str] = None
    data: dict[str, Any]


class SearchPayload(BaseModel):
    vector: list[float]
    top_k: int = 5
    min_score: float = 0.0
    filter_levels: Optional[list[str]] = None
    include_obsolete: bool = False
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/memories", status_code=201)
def save_memory(payload: MemoryPayload) -> dict[str, str]:
    with _LOCK:
        if payload.level == "working":
            _save_working(payload)
        else:
            _save_persistent(payload)
    return {"id": payload.id}


def _save_working(payload: MemoryPayload) -> None:
    session_id = payload.session_id
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required for working memory")

    if session_id not in _working_collections:
        coll_path = os.path.join(_DATA_DIR, "working", f"{session_id}.zvec")
        _working_collections[session_id] = _open_or_create_collection(
            coll_path, f"working-{session_id}", _DIMENSION
        )
        _working_data[session_id] = {}

    embedding = payload.embedding or payload.data.get("embedding", [])
    _upsert_vector(_working_collections[session_id], payload.id, embedding)

    _working_data[session_id][payload.id] = payload.data
    meta_path = os.path.join(_DATA_DIR, "working", f"{session_id}.json")
    _flush_meta(meta_path, _working_data[session_id])


def _save_persistent(payload: MemoryPayload) -> None:
    embedding = payload.embedding or payload.data.get("embedding", [])
    _upsert_vector(_persistent_collection, payload.id, embedding)

    _persistent_data[payload.id] = payload.data
    _flush_meta(_persistent_meta_path, _persistent_data)


@app.get("/memories/{memory_id}")
def get_memory(memory_id: str) -> dict[str, Any]:
    with _LOCK:
        if memory_id in _persistent_data:
            return _persistent_data[memory_id]
        for session_data in _working_data.values():
            if memory_id in session_data:
                return session_data[memory_id]
    raise HTTPException(status_code=404, detail=f"memory not found: {memory_id}")


@app.get("/memories")
def list_memories(
    levels: Optional[str] = None,
    include_obsolete: bool = False,
    limit: int = 0,
    reverse: bool = False,
    session_id: Optional[str] = None,
) -> dict[str, list[dict[str, Any]]]:
    with _LOCK:
        memories: list[dict[str, Any]] = []
        level_filter = set(levels.split(",")) if levels else None

        # Working memories.
        if level_filter is None or "working" in level_filter:
            sessions: dict[str, dict[str, Any]]
            if session_id:
                sessions = {session_id: _working_data.get(session_id, {})}
            else:
                sessions = _working_data
            for sd in sessions.values():
                for m in sd.values():
                    if not include_obsolete and m.get("obsolete"):
                        continue
                    memories.append(m)

        # Persistent memories (episodic + semantic).
        for m in _persistent_data.values():
            lvl = m.get("level", "")
            if level_filter and lvl not in level_filter:
                continue
            if not include_obsolete and m.get("obsolete"):
                continue
            memories.append(m)

        # Sort by created_at descending (newest first) unless reverse is True.
        memories.sort(key=lambda m: m.get("created_at", ""), reverse=not reverse)

        if limit > 0:
            memories = memories[:limit]

        return {"memories": memories}


@app.delete("/memories/{memory_id}", status_code=204)
def delete_memory(memory_id: str) -> None:
    with _LOCK:
        if memory_id in _persistent_data:
            del _persistent_data[memory_id]
            _persistent_collection.delete(memory_id)
            _flush_meta(_persistent_meta_path, _persistent_data)
            return

        for session_id, session_data in _working_data.items():
            if memory_id in session_data:
                del session_data[memory_id]
                if session_id in _working_collections:
                    _working_collections[session_id].delete(memory_id)
                meta_path = os.path.join(_DATA_DIR, "working", f"{session_id}.json")
                _flush_meta(meta_path, session_data)
                return

    raise HTTPException(status_code=404, detail=f"memory not found: {memory_id}")


@app.put("/memories/{memory_id}")
def update_memory(memory_id: str, payload: UpdatePayload) -> dict[str, str]:
    save_memory(
        MemoryPayload(
            id=memory_id,
            level=payload.level,
            embedding=payload.embedding,
            session_id=payload.session_id,
            data=payload.data,
        )
    )
    return {"id": memory_id}


@app.post("/search")
def search(payload: SearchPayload) -> dict[str, list[dict[str, Any]]]:
    with _LOCK:
        results: list[dict[str, Any]] = []
        search_levels = payload.filter_levels or ["working", "episodic", "semantic"]

        # Search working collections.
        if "working" in search_levels:
            sessions: dict[str, dict[str, Any]]
            if payload.session_id:
                sessions = {
                    payload.session_id: _working_data.get(payload.session_id, {})
                }
            else:
                sessions = _working_data

            for sid, session_data in sessions.items():
                coll = _working_collections.get(sid)
                if coll is None:
                    continue
                query = zvec.VectorQuery("embedding", vector=payload.vector)
                # Request more than top_k to allow for post-filter
                docs = coll.query(query, topk=max(payload.top_k * 3, 10))
                for doc in docs:
                    if doc.score < payload.min_score:
                        continue
                    m = session_data.get(doc.id)
                    if m is None:
                        continue
                    if not payload.include_obsolete and m.get("obsolete"):
                        continue
                    results.append({"memory": m, "score": doc.score})

        # Search persistent (episodic + semantic).
        persistent_levels = [lv for lv in search_levels if lv != "working"]
        if persistent_levels and _persistent_collection is not None:
            query = zvec.VectorQuery("embedding", vector=payload.vector)
            docs = _persistent_collection.query(
                query, topk=max(payload.top_k * 3, 10)
            )
            for doc in docs:
                if doc.score < payload.min_score:
                    continue
                m = _persistent_data.get(doc.id)
                if m is None:
                    continue
                if m.get("level") not in persistent_levels:
                    continue
                if not payload.include_obsolete and m.get("obsolete"):
                    continue
                results.append({"memory": m, "score": doc.score})

        # Sort by score descending, then take top_k.
        results.sort(key=lambda r: r["score"], reverse=True)
        if payload.top_k > 0:
            results = results[: payload.top_k]

        return {"results": results}


@app.post("/transfer/{session_id}")
def transfer_working_to_episodic(session_id: str) -> dict[str, int]:
    with _LOCK:
        session_data = _working_data.get(session_id)
        if not session_data:
            raise HTTPException(
                status_code=404, detail=f"session not found: {session_id}"
            )

        coll = _working_collections.get(session_id)
        count = 0
        for memory_id, m in session_data.items():
            m["level"] = "episodic"
            # Retrieve embedding from zvec working collection.
            embedding: list[float] = []
            if coll is not None:
                embedding = _get_embedding_from_collection(coll, memory_id)
            _persistent_data[memory_id] = m
            _upsert_vector(_persistent_collection, memory_id, embedding)
            count += 1

        # Clean up the working session.
        del _working_data[session_id]
        if coll is not None:
            coll.destroy()
            del _working_collections[session_id]

        meta_path = os.path.join(_DATA_DIR, "working", f"{session_id}.json")
        if os.path.exists(meta_path):
            os.remove(meta_path)

        _flush_meta(_persistent_meta_path, _persistent_data)
        return {"transferred": count}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Cortex zvec sidecar server")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port to listen on")
    parser.add_argument(
        "--data-dir", required=True, help="Directory for data storage"
    )
    parser.add_argument(
        "--dimension", type=int, default=768, help="Vector embedding dimension"
    )
    args = parser.parse_args()

    _init_storage(args.data_dir, args.dimension)

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
