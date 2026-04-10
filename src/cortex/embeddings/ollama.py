"""Ollama embedding client with chunking, normalization and LRU cache."""

from __future__ import annotations

import threading
from typing import Any

import httpx
import numpy as np
from cachetools import LRUCache

from cortex.config.settings import EmbeddingsConfig
from cortex.search.cosine import normalize


class OllamaEmbedder:
    """Embeds text via the Ollama HTTP API.

    Features:
    - Automatic text chunking when content exceeds chunk_size
    - Chunk strategies: average (default), first, max_pool
    - L2 vector normalization to unit length
    - LRU embedding cache (128 entries)
    """

    _CACHE_SIZE = 128

    def __init__(self, config: EmbeddingsConfig) -> None:
        self._config = config
        self._cache: LRUCache[str, list[float]] = LRUCache(maxsize=self._CACHE_SIZE)
        self._cache_lock = threading.Lock()
        self._dim: int | None = None
        self._dim_lock = threading.Lock()
        self._client = httpx.Client(timeout=config.timeout)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def embed(self, text: str) -> list[float]:
        """Embed text, using the cache when possible."""
        with self._cache_lock:
            cached = self._cache.get(text)
            if cached is not None:
                return cached

        vector = self._embed_with_chunking(text)

        with self._cache_lock:
            self._cache[text] = vector

        return vector

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts, using cached results when available."""
        results: list[list[float] | None] = [None] * len(texts)
        missing_indices: list[int] = []

        with self._cache_lock:
            for i, text in enumerate(texts):
                cached = self._cache.get(text)
                if cached is not None:
                    results[i] = cached
                else:
                    missing_indices.append(i)

        for i in missing_indices:
            vector = self._embed_with_chunking(texts[i])
            results[i] = vector
            with self._cache_lock:
                self._cache[texts[i]] = vector

        return [r for r in results if r is not None]

    @property
    def dimension(self) -> int:
        """Return embedding dimension, detecting lazily on first call."""
        with self._dim_lock:
            if self._dim is None:
                probe = self._raw_embed("probe")
                self._dim = len(probe)
        return self._dim

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _embed_with_chunking(self, text: str) -> list[float]:
        """Embed text, chunking if necessary, then apply chunk strategy."""
        chunk_size = self._config.chunk_size
        if len(text) <= chunk_size:
            return normalize(self._raw_embed(text))

        chunks = self._chunk_text(text)
        chunk_vectors = [self._raw_embed(c) for c in chunks]

        strategy = self._config.chunk_strategy
        if strategy == "first":
            combined = chunk_vectors[0]
        elif strategy == "max_pool":
            combined = np.max(np.array(chunk_vectors), axis=0).tolist()
        else:  # average (default)
            combined = np.mean(np.array(chunk_vectors), axis=0).tolist()

        return normalize(combined)

    def _chunk_text(self, text: str) -> list[str]:
        """Split text into overlapping chunks."""
        size = self._config.chunk_size
        overlap = self._config.chunk_overlap
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(start + size, len(text))
            chunks.append(text[start:end])
            if end == len(text):
                break
            start += size - overlap
        return chunks

    def _raw_embed(self, text: str) -> list[float]:
        """Make a single HTTP request to the Ollama embeddings endpoint."""
        url = f"{self._config.endpoint.rstrip('/')}/api/embeddings"
        payload: dict[str, Any] = {"model": self._config.model, "prompt": text}
        response = self._client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        embedding: list[float] = data["embedding"]
        return embedding
