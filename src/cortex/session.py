"""Session ID derivation from git branch names."""

from __future__ import annotations

import re
import subprocess
from uuid import uuid4

from cortex.config.settings import SessionConfig


def derive_session_id(config: SessionConfig) -> str:
    """Derive a session ID from the current git branch.

    Falls back to a UUID if not in a git repo or if the branch
    cannot be determined and fallback_to_uuid is enabled.

    Raises RuntimeError if auto_derive fails and fallback is disabled.
    """
    if not config.auto_derive:
        return _uuid_session(config)

    branch = _get_git_branch()
    if not branch:
        if config.fallback_to_uuid:
            return _uuid_session(config)
        raise RuntimeError("Could not determine git branch for session ID derivation")

    return _branch_to_session(branch, config)


def _get_git_branch() -> str | None:
    """Return the current git branch name, or None if unavailable."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            branch = result.stdout.strip()
            return branch if branch and branch != "HEAD" else None
    except Exception:
        pass
    return None


def _branch_to_session(branch: str, config: SessionConfig) -> str:
    """Convert a git branch name to a session ID per config rules."""
    pattern_type = config.pattern_type

    if pattern_type == "full":
        slug = _slugify(branch)
        return f"{config.prefix}{slug}"

    if pattern_type == "regex" and config.pattern:
        match = re.search(config.pattern, branch)
        if match:
            slug = _slugify(match.group(0))
            return f"{config.prefix}{slug}"
        # Fall through to prefix mode on regex miss

    # Default: prefix mode — split on delimiters, take max_segments
    # Strip any configured prefix from the branch first
    working = branch
    if config.strip_prefix and working.startswith(config.strip_prefix):
        working = working[len(config.strip_prefix) :]

    segments = re.split(r"[/\-_]", working)
    segments = [s for s in segments if s][: config.max_segments]
    slug = config.separator.join(segments)
    return f"{config.prefix}{slug}"


def _uuid_session(config: SessionConfig) -> str:
    return f"{config.prefix}{uuid4()}"


def _slugify(text: str) -> str:
    """Convert text to a safe slug for session IDs."""
    return re.sub(r"[^a-zA-Z0-9\-_]", "-", text).strip("-")
