"""Utility functions for Cortex."""

from __future__ import annotations


def dedupe_list(items: list[str]) -> list[str]:
    """Deduplicate a list while preserving insertion order.

    Uses dict.fromkeys() which is guaranteed ordered in Python 3.7+.
    """
    return list(dict.fromkeys(items))
