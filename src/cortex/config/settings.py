"""Cortex configuration via pydantic-settings.

Priority: CLI flags > CORTEX_* env vars > YAML config file > defaults.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)


class StorageConfig(BaseModel):
    backend: str = "chroma"
    path: str = ".agents/cortex"


class EmbeddingsConfig(BaseModel):
    provider: str = "ollama"
    model: str = "nomic-embed-text"
    endpoint: str = "http://localhost:11434"
    timeout: int = 30  # seconds
    chunk_size: int = 8000
    chunk_overlap: int = 200
    chunk_strategy: str = "average"  # average | first | max_pool


class SearchConfig(BaseModel):
    top_k: int = 5
    min_score: float = 0.5
    include_obsolete: bool = False


class OutputConfig(BaseModel):
    format: str = "text"  # text | json
    colors: bool = True


class LoggingConfig(BaseModel):
    level: str = "info"
    file: str = ""


class ConsolidationConfig(BaseModel):
    similarity_threshold: float = 0.85
    auto_transfer_on_session_end: bool = True


class AutopruneConfig(BaseModel):
    duplicates_threshold: float = 0.92
    episodic_retention_days: int = 90
    semantic_merge_threshold: float = 0.88


class SessionConfig(BaseModel):
    auto_derive: bool = True
    pattern_type: str = "prefix"  # prefix | regex | full
    pattern: str = ""
    prefix: str = "session-"
    separator: str = "-"
    max_segments: int = 2
    strip_prefix: str = ""
    fallback_to_uuid: bool = True


class MCPConfig(BaseModel):
    transport: str = "stdio"
    address: str = ":8080"


class Settings(BaseSettings):
    """Global Cortex settings loaded from YAML + environment variables.

    Env vars use CORTEX_ prefix with __ as nested delimiter.
    Example: CORTEX_EMBEDDINGS__MODEL=all-minilm sets embeddings.model.
    """

    model_config = SettingsConfigDict(
        env_prefix="CORTEX_",
        env_nested_delimiter="__",
        yaml_file_encoding="utf-8",
        # yaml_file set dynamically via classmethod
    )

    storage: StorageConfig = Field(default_factory=StorageConfig)
    embeddings: EmbeddingsConfig = Field(default_factory=EmbeddingsConfig)
    search: SearchConfig = Field(default_factory=SearchConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    consolidation: ConsolidationConfig = Field(default_factory=ConsolidationConfig)
    autoprune: AutopruneConfig = Field(default_factory=AutopruneConfig)
    session: SessionConfig = Field(default_factory=SessionConfig)
    mcp: MCPConfig = Field(default_factory=MCPConfig)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        yaml_path = _get_config_path()
        if yaml_path and Path(yaml_path).exists():
            return (
                init_settings,
                env_settings,
                YamlConfigSettingsSource(settings_cls, yaml_file=yaml_path),
            )
        return (init_settings, env_settings)


def _get_config_path() -> str:
    """Resolve the config file path from env or default."""
    env_path = os.environ.get("CORTEX_CONFIG", "")
    if env_path:
        return env_path
    default = Path(".agents/cortex/config.yaml")
    if default.exists():
        return str(default)
    return ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached global Settings instance."""
    return Settings()


def reset_settings() -> None:
    """Clear the settings cache (for testing)."""
    get_settings.cache_clear()


def load_settings(config_path: str | None = None) -> Settings:
    """Load settings, optionally overriding the config file path."""
    if config_path:
        os.environ["CORTEX_CONFIG"] = config_path
    reset_settings()
    return get_settings()
