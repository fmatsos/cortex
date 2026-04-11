"""Core memory domain models."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


class MemoryLevel(StrEnum):
    working = "working"
    episodic = "episodic"
    semantic = "semantic"


class MemorySource(StrEnum):
    manual = "manual"
    auto = "auto"
    llm = "llm"


class MemoryContext(BaseModel):
    """Metadata and relationship context for a memory."""

    task_id: str = ""
    session_id: str = ""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    author: str = ""
    tags: list[str] = Field(default_factory=list)
    source: MemorySource = MemorySource.manual
    related_memories: list[str] = Field(default_factory=list)
    # Save-context fields: record where/how the memory was created.
    git_branch: str = ""  # Git branch at save time (auto-detected when empty)
    agent_name: str = ""  # AI agent name (e.g. "Claude", "Copilot")
    agent_session_id: str = ""  # AI agent session ID
    user_prompt: str = ""  # Triggering user prompt

    model_config = {"use_enum_values": True}


class Memory(BaseModel):
    """A single piece of knowledge in the three-layer memory system."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    level: MemoryLevel
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    embedding: list[float] = Field(default_factory=list)
    context: MemoryContext = Field(default_factory=MemoryContext)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    merged_from: list[str] = Field(default_factory=list)
    obsolete: bool = False

    model_config = {"use_enum_values": True}

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("title must be at least 3 characters")
        if len(v) > 60:
            raise ValueError("title must be at most 60 characters")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("content must be at least 10 characters")
        return v

    @model_validator(mode="after")
    def validate_working_session(self) -> Memory:
        if self.level == MemoryLevel.working and not self.context.session_id:
            raise ValueError("session_id is required in context for working level memories")
        return self

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.now(UTC)

    @property
    def timestamp(self) -> int:
        """Unix timestamp derived from created_at (seconds since epoch)."""
        return int(self.created_at.timestamp())

    @classmethod
    def derive_title(cls, content: str, max_length: int = 60) -> str:
        """Derive a title from content (first sentence, capped at max_length)."""
        first_line = content.strip().splitlines()[0] if content.strip() else content
        title = first_line[:max_length].strip()
        if len(title) < 3:
            title = (content.strip()[:max_length]).strip()
        return title or "Memory"


# Type alias for annotated ID
MemoryID = Annotated[str, Field(min_length=1)]
