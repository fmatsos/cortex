"""Utility functions for Cortex."""

from __future__ import annotations


def dedupe_list(items: list[str]) -> list[str]:
    """Deduplicate a list while preserving order.

    Args:
        items: List of strings with possible duplicates.

    Returns:
        List with duplicates removed, order preserved.
    """
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
