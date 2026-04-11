"""Logging configuration for Cortex."""

from __future__ import annotations

import logging
import sys


def configure_logging(level: str) -> None:
    """Configure Python logging with the specified level.

    Args:
        level: Log level (debug, info, warning, error, critical).
    """
    # Map string level to logging constant
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    # Configure root logger
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        stream=sys.stderr,
    )
