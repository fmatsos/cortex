"""Tests for cosine similarity utility."""

from __future__ import annotations

import pytest
import numpy as np

from cortex.search.cosine import cosine_similarity, normalize


class TestCosineSimilarity:
    def test_identical_vectors(self) -> None:
        v = [1.0, 0.0, 0.0]
        assert cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0)

    def test_opposite_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert cosine_similarity(a, b) == pytest.approx(-1.0)

    def test_empty_vectors(self) -> None:
        with pytest.raises(ValueError, match="Vectors cannot be empty"):
            cosine_similarity([], [])

    def test_different_lengths(self) -> None:
        with pytest.raises(ValueError, match="Vector dimension mismatch"):
            cosine_similarity([1.0, 2.0], [1.0, 2.0, 3.0])

    def test_zero_vector(self) -> None:
        assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_normalized_vectors_are_dot_product(self) -> None:
        a = [0.6, 0.8]  # unit vector
        b = [0.8, 0.6]  # unit vector
        expected = 0.6 * 0.8 + 0.8 * 0.6
        assert cosine_similarity(a, b) == pytest.approx(expected)


class TestNormalize:
    def test_unit_norm(self) -> None:
        v = [3.0, 4.0]  # norm = 5
        normalized = normalize(v)
        assert np.linalg.norm(normalized) == pytest.approx(1.0)

    def test_already_normalized(self) -> None:
        v = [1.0, 0.0]
        assert normalize(v) == pytest.approx(v)

    def test_zero_vector_unchanged(self) -> None:
        v = [0.0, 0.0, 0.0]
        assert normalize(v) == v

    def test_negative_values(self) -> None:
        v = [-3.0, 4.0]
        normalized = normalize(v)
        assert np.linalg.norm(normalized) == pytest.approx(1.0)
