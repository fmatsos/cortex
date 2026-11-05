// Entry point of the distributed builds only (scripts/build.sh): the compiled binary and the cortex.js bundle.
// Embeds the sources tarball (base64, so the bundle stays one file too), records the distribution, then runs the CLI.
import payload from "#payload";
import pkg from "../package.json";

declare const CORTEX_DIST_BUILD: "binary" | "bundle"; // set by `bun build --define`

globalThis.CORTEX_PAYLOAD = payload;
globalThis.CORTEX_DIST = CORTEX_DIST_BUILD;
// cortex.js runs on the user's bun: refuse an older one with a clear message rather than a cryptic failure later
if (!Bun.semver.satisfies(Bun.version, pkg.engines.bun)) {
  console.error(`✗ cortex needs bun ${pkg.engines.bun} (found ${Bun.version}): run bun upgrade.`);
  process.exit(1);
}
await import("./cortex");
