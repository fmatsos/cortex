"""Entry point for uvx/python -m cortex."""

from cortex.cli.app import app


def main() -> None:
    app()


if __name__ == "__main__":
    main()
