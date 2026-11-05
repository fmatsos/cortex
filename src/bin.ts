// Entry point of the compiled binary only (scripts/build.sh): embeds the sources tarball, then runs the CLI.
import payload from "../build/payload.tar.gz" with { type: "file" };

globalThis.CORTEX_PAYLOAD = payload;
await import("./cortex");
