"""Cosine similarity for vector comparison."""

from __future__ import annotations

import numpy as np


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors.

    Returns a value in [0, 1] for L2-normalized vectors.
    Returns 0.0 for empty or zero-norm vectors.
    """
    if not a or not b or len(a) != len(b):
        return 0.0

    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)

    dot = float(np.dot(va, vb))
    norm_a = float(np.linalg.norm(va))
    norm_b = float(np.linalg.norm(vb))

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    return dot / (norm_a * norm_b)


def normalize(vector: list[float]) -> list[float]:
    """L2-normalize a vector to unit length."""
    v = np.array(vector, dtype=np.float64)
    norm = float(np.linalg.norm(v))
    if norm == 0.0:
        return vector
    return (v / norm).tolist()
