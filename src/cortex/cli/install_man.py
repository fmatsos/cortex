"""cortex install-man — install the cortex man page to the system."""

from __future__ import annotations

import importlib.resources
import shutil
from pathlib import Path
from typing import Annotated

import typer


def install_man(
    dir: Annotated[
        str,
        typer.Option(
            "--dir",
            help="Man page directory (default: ~/.local/share/man/man1)",
        ),
    ] = "",
    system: Annotated[
        bool,
        typer.Option(
            "--system",
            help="Install to /usr/local/share/man/man1 (requires root)",
        ),
    ] = False,
) -> None:
    """Install the cortex man page to the system.

    Installs man/man1/cortex.1 so that \b
        man cortex
    works after running \b
        mandb  (or man-db equivalent).
    """
    if system:
        target_dir = Path("/usr/local/share/man/man1")
    elif dir:
        target_dir = Path(dir)
    else:
        target_dir = Path.home() / ".local" / "share" / "man" / "man1"

    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / "cortex.1"

    # Locate the bundled man page shipped with the package
    try:
        pkg_files = importlib.resources.files("cortex")
        man_source = pkg_files / "man" / "cortex.1"
        with importlib.resources.as_file(man_source) as src_path:
            shutil.copy2(src_path, dest)
    except (FileNotFoundError, TypeError):
        # Fall back to the repository layout (editable / dev installs)
        repo_root = Path(__file__).parent.parent.parent.parent
        fallback = repo_root / "man" / "man1" / "cortex.1"
        if not fallback.exists():
            typer.echo(
                f"Error: man page source not found. Expected: {fallback}",
                err=True,
            )
            raise typer.Exit(1) from None
        shutil.copy2(fallback, dest)

    typer.echo(f"Installed: {dest}")
    typer.echo("Run 'mandb' (or 'sudo mandb') to update the man database.")
