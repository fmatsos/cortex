"""CLI golden tests using syrupy snapshots."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from cortex.cli.app import app
from tests.conftest import MockEmbedder
from tests.test_storage import make_memory

# (module, has_get_storage, has_get_embedder)
_CLI_MODULES = [
    ("cortex.cli.create", True, True),
    ("cortex.cli.search", True, True),
    ("cortex.cli.list_", True, False),
    ("cortex.cli.get", True, False),
    ("cortex.cli.delete", True, False),
    ("cortex.cli.stats", True, False),
    ("cortex.cli.transfer_working", True, False),
    ("cortex.cli.consolidate", True, True),
    ("cortex.cli.autoprune", True, False),
    ("cortex.cli.export_", True, False),
    ("cortex.cli.import_", True, True),
]


@pytest.fixture(autouse=True)
def patch_embedder_and_storage(tmp_path: Path, chroma_storage: object):
    """Patch CLI helpers to use mock embedder and temp storage for all CLI tests.

    Each CLI command module imports get_storage/get_embedder by value, so we must
    patch the name in each module's namespace rather than in _common.
    """
    import contextlib

    mock_emb = MockEmbedder()

    with contextlib.ExitStack() as stack:
        for mod, has_storage, has_embedder in _CLI_MODULES:
            if has_storage:
                stack.enter_context(patch(f"{mod}.get_storage", return_value=chroma_storage))
            if has_embedder:
                stack.enter_context(patch(f"{mod}.get_embedder", return_value=mock_emb))
        yield


class TestCreateCommand:
    def test_create_episodic(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(
            app,
            [
                "create",
                "--title",
                "Test memory",
                "--content",
                "This is test content for the memory.",
                "--level",
                "episodic",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["title"] == "Test memory"
        assert data["level"] == "episodic"

    def test_create_requires_content(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(app, ["create", "--title", "Test", "--level", "episodic"])
        assert result.exit_code != 0

    def test_create_with_tags(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(
            app,
            [
                "create",
                "--title",
                "Tagged memory",
                "--content",
                "Content with tags attached.",
                "--level",
                "semantic",
                "--tags",
                "auth,jwt,bug",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "auth" in data["tags"]
        assert "jwt" in data["tags"]


class TestSearchCommand:
    def test_search_empty_db(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(app, ["search", "test query", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data == []

    def test_search_with_results(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        # Pre-populate storage
        MockEmbedder()
        m = make_memory(
            level=__import__("cortex.models.memory", fromlist=["MemoryLevel"]).MemoryLevel.episodic,
            title="JWT auth fix",
            content="Fixed authentication with JWT refresh tokens.",
        )
        chroma_storage.save(m)  # type: ignore[union-attr]

        result = cli_runner.invoke(
            app,
            ["search", "JWT authentication", "--min-score", "0.0", "--json"],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) > 0
        assert "score" in data[0]


class TestListCommand:
    def test_list_empty(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(app, ["list", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data == []

    def test_list_with_memories(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        from cortex.models.memory import MemoryLevel

        m1 = make_memory(level=MemoryLevel.episodic, title="First")
        m2 = make_memory(level=MemoryLevel.semantic, title="Second")
        chroma_storage.save(m1)  # type: ignore[union-attr]
        chroma_storage.save(m2)  # type: ignore[union-attr]

        result = cli_runner.invoke(app, ["list", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 2


class TestGetCommand:
    def test_get_by_id(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        m = make_memory(title="Specific memory")
        chroma_storage.save(m)  # type: ignore[union-attr]

        result = cli_runner.invoke(app, ["get", m.id, "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == m.id

    def test_get_by_prefix(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        m = make_memory(title="Prefix test")
        chroma_storage.save(m)  # type: ignore[union-attr]

        result = cli_runner.invoke(app, ["get", m.id[:8], "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == m.id

    def test_get_not_found(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(app, ["get", "nonexistent-id"])
        assert result.exit_code != 0


class TestStatsCommand:
    def test_stats_json(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        from cortex.models.memory import MemoryLevel

        chroma_storage.save(make_memory(level=MemoryLevel.episodic, title="Episodic one"))  # type: ignore[union-attr]
        chroma_storage.save(make_memory(level=MemoryLevel.semantic, title="Semantic one"))  # type: ignore[union-attr]

        result = cli_runner.invoke(app, ["stats", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["episodic"] == 1
        assert data["semantic"] == 1
        assert data["working"] == 0
        assert data["total"] == 2


class TestConfigCommand:
    def test_config_json(self, cli_runner: CliRunner) -> None:
        result = cli_runner.invoke(app, ["config", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "embeddings" in data
        assert "storage" in data
        assert "search" in data


class TestTransferWorkingCommand:
    def test_transfer_working(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        from cortex.models.memory import MemoryLevel

        m = make_memory(
            level=MemoryLevel.working,
            title="Working memory",
            session_id="session-test",
        )
        chroma_storage.save(m)  # type: ignore[union-attr]

        result = cli_runner.invoke(
            app,
            ["transfer-working", "--session", "session-test", "--json"],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["transferred"] == 1
