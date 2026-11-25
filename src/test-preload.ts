import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Loaded before every test file (bunfig.toml). The whole suite shares one scratch directory: TMPDIR points at it, so every
// mkdtemp(tmpdir()) in a test, and in each cortex or bun child it spawns (they inherit process.env), lands inside it. It is
// removed in one go when the run ends, so `bun test` leaves nothing behind in /tmp (thousands of cortex-* dirs used to pile up).
const scratch = mkdtempSync(join(tmpdir(), "cortex-test-"));
process.env.TMPDIR = scratch;
const clean = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} };
afterAll(clean); // bun test does not emit "exit" on a normal end, but runs a preload's afterAll once after the last file
process.on("exit", clean);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { clean(); process.exit(128); });

// The user's ~/.config/cortex/remotes.json must never be read, or a test running cortex outside a wiki would forward its
// command over ssh to the real wiki. Spawned cortex inherit process.env.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(scratch, "xdg-"));
delete process.env.CORTEX_WIKI;
