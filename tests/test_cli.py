"""CLI golden tests using syrupy snapshots."""

from __future__ import annotations

import json
import stat
import tomllib
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
        assert data["memories"] == []
        assert data["total"] == 0

    def test_list_with_memories(self, cli_runner: CliRunner, chroma_storage: object) -> None:
        from cortex.models.memory import MemoryLevel

        m1 = make_memory(level=MemoryLevel.episodic, title="First")
        m2 = make_memory(level=MemoryLevel.semantic, title="Second")
        chroma_storage.save(m1)  # type: ignore[union-attr]
        chroma_storage.save(m2)  # type: ignore[union-attr]

        result = cli_runner.invoke(app, ["list", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data["memories"]) == 2
        assert data["total"] == 2


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


class TestInitCommand:
    def test_init_creates_global_config(
        self, cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = tmp_path / "home"
        monkeypatch.setenv("HOME", str(home))

        result = cli_runner.invoke(app, ["init"])

        assert result.exit_code == 0
        config_path = home / ".config" / "cortex" / "config.toml"
        assert config_path.exists()
        data = tomllib.loads(config_path.read_text())
        assert "storage" in data

    def test_init_local_does_not_overwrite(
        self, cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = tmp_path / "home"
        monkeypatch.setenv("HOME", str(home))
        with cli_runner.isolated_filesystem():
            local_path = Path(".agents/cortex/config.toml")
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_text("# existing", encoding="utf-8")

            result = cli_runner.invoke(app, ["init", "--local"])

            assert result.exit_code == 0
            assert local_path.read_text() == "# existing"


class TestHookCommand:
    def test_hook_merges_existing_settings(
        self, cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = tmp_path / "home"
        monkeypatch.setenv("HOME", str(home))
        base = home / ".claude"
        base.mkdir(parents=True, exist_ok=True)
        existing = {
            "hooks": {
                "SessionStart": [{"hooks": [{"type": "command", "command": "custom-start"}]}],
                "Stop": [{"hooks": [{"type": "command", "command": "custom-stop"}]}],
            }
        }
        settings_path = base / "settings.json"
        settings_path.write_text(json.dumps(existing), encoding="utf-8")

        result = cli_runner.invoke(app, ["hook", "--claude"])

        assert result.exit_code == 0
        updated = json.loads(settings_path.read_text())
        assert "hooks" in updated
        start_entries = updated["hooks"]["SessionStart"]
        commands = [
            hook.get("command")
            for entry in start_entries
            if isinstance(entry, dict)
            for hook in entry.get("hooks", [])
            if isinstance(hook, dict)
        ]
        cortex_command = f"bash {base / 'hooks' / 'session-start.sh'}"
        assert "custom-start" in commands
        assert commands.count(cortex_command) == 1

        script_path = base / "hooks" / "session-start.sh"
        assert script_path.exists()
        assert script_path.stat().st_mode & stat.S_IXUSR


class TestCreateCommandSaveContext:
    def test_create_with_git_branch_flag(self, cli_runner: CliRunner) -> None:
        """PR #38: --git-branch flag is accepted and stored."""
        result = cli_runner.invoke(
            app,
            [
                "create",
                "--title",
                "Branch test",
                "--content",
                "Content with explicit git branch field.",
                "--level",
                "episodic",
                "--git-branch",
                "feature/test-branch",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["context"]["git_branch"] == "feature/test-branch"

    def test_create_with_all_save_context_flags(self, cli_runner: CliRunner) -> None:
        """PR #38: --agent-name, --agent-session, --user-prompt flags work."""
        result = cli_runner.invoke(
            app,
            [
                "create",
                "--title",
                "Full context test",
                "--content",
                "Content with all save-context fields set.",
                "--level",
                "semantic",
                "--agent-name",
                "claude",
                "--agent-session",
                "agent-sess-42",
                "--user-prompt",
                "help me fix this",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["context"]["agent_name"] == "claude"
        assert data["context"]["agent_session_id"] == "agent-sess-42"
        assert data["context"]["user_prompt"] == "help me fix this"


class TestInstallManCommand:
    def test_install_man_to_temp_dir(self, cli_runner: CliRunner, tmp_path: Path) -> None:
        """PR #14: install-man copies man page to the given prefix."""
        result = cli_runner.invoke(
            app,
            ["install-man", "--prefix", str(tmp_path)],
        )
        assert result.exit_code == 0
        dest = tmp_path / "share" / "man" / "man1" / "cortex.1"
        assert dest.exists(), f"Expected man page at {dest}"
        content = dest.read_text()
        assert ".TH CORTEX" in content

    def test_install_man_output_message(self, cli_runner: CliRunner, tmp_path: Path) -> None:
        """PR #14: install-man prints the destination path."""
        result = cli_runner.invoke(
            app,
            ["install-man", "--prefix", str(tmp_path)],
        )
        assert result.exit_code == 0
        assert "cortex.1" in result.output


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
