"""cortex install-man — install the bundled man page to the system."""

from __future__ import annotations

import contextlib
import shutil
import subprocess
from pathlib import Path
from typing import Annotated

import typer

_DEFAULT_PREFIX = "/usr/local"
_MAN1_REL = "share/man/man1"
_MAN_FILENAME = "cortex.1"


def _bundled_man_page() -> Path:
    """Return the path to the bundled man page.

    Tries importlib.resources first (installed wheel), then falls back to
    the repo-relative path for editable installs.
    """
    with contextlib.suppress(Exception):
        # Python 3.9+ importlib.resources API
        from importlib.resources import files

        return Path(str(files("cortex.cli.manpage").joinpath(_MAN_FILENAME)))

    # Editable install fallback — file lives next to this module
    candidate = Path(__file__).parent / "manpage" / _MAN_FILENAME
    if candidate.exists():
        return candidate

    raise FileNotFoundError(f"Bundled man page not found: {_MAN_FILENAME}")


def install_man(
    prefix: Annotated[
        str,
        typer.Option(
            "--prefix",
            help=f"Installation prefix (default: {_DEFAULT_PREFIX})",
        ),
    ] = _DEFAULT_PREFIX,
) -> None:
    """Install the cortex man page to <prefix>/share/man/man1/."""
    src = _bundled_man_page()

    dest_dir = Path(prefix) / _MAN1_REL
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _MAN_FILENAME

    shutil.copy2(src, dest)
    typer.echo(f"Installed {dest}")

    # Update the man database if mandb or makewhatis is available
    for cmd in ("mandb", "makewhatis"):
        if shutil.which(cmd):
            with contextlib.suppress(Exception):
                subprocess.run([cmd], capture_output=True, check=False)
            break
