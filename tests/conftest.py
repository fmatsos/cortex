"""Shared test fixtures for Cortex test suite."""

from __future__ import annotations

import hashlib
from collections.abc import Generator
from pathlib import Path

import numpy as np
import pytest
from typer.testing import CliRunner

from cortex.config.settings import reset_settings
from cortex.storage.chroma import ChromaStorage


class MockEmbedder:
    """Deterministic embedder for testing.

    Same text always produces the same 768-dim normalized vector,
    without requiring an Ollama server.
    """

    _DIM = 768

    def embed(self, text: str) -> list[float]:
        seed = int(hashlib.md5(text.encode()).hexdigest(), 16) % (2**32)
        rng = np.random.default_rng(seed)
        v = rng.standard_normal(self._DIM)
        norm = float(np.linalg.norm(v))
        return (v / norm).tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(t) for t in texts]

    @property
    def dimension(self) -> int:
        return self._DIM


@pytest.fixture
def mock_embedder() -> MockEmbedder:
    """Return a deterministic mock embedder."""
    return MockEmbedder()


@pytest.fixture
def chroma_storage(tmp_path: Path) -> Generator[ChromaStorage, None, None]:
    """Return a fresh ChromaDB storage backed by a temp directory."""
    storage = ChromaStorage(path=str(tmp_path / "chroma"))
    yield storage
    storage.close()


@pytest.fixture
def cli_runner() -> CliRunner:
    """Return a Typer CLI test runner."""
    return CliRunner()


@pytest.fixture(autouse=True)
def reset_config() -> Generator[None, None, None]:
    """Clear settings cache before and after each test."""
    reset_settings()
    yield
    reset_settings()
