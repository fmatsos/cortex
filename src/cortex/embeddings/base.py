"""Embedder protocol definition."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class Embedder(Protocol):
    """Protocol for text embedding providers."""

    def embed(self, text: str) -> list[float]:
        """Embed a single text string and return its vector."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts and return their vectors.

        Prefer this over repeated embed() calls to reduce round-trips.
        """
        ...

    @property
    def dimension(self) -> int:
        """Return the embedding vector dimension."""
        ...
