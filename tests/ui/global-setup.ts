import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticServer } from "./static-server";

const here = import.meta.dirname;

// Exports the wiki once (CORTEX_UI_WIKI, else the committed fixture) into a temp folder and serves it on a free port.
// Workers read the address from CORTEX_UI_BASE. The wiki is copied first: an export writes under the wiki's .cortex/.
export default async function globalSetup() {
  const tmp = mkdtempSync(join(tmpdir(), "cortex-ui-"));
  const wiki = join(tmp, "wiki-root"), out = join(tmp, "site");
  cpSync(process.env.CORTEX_UI_WIKI || join(here, "fixture"), wiki, { recursive: true });
  const r = spawnSync("bun", [join(here, "../../src/cortex.ts"), "export", "--out", out], { env: { ...process.env, CORTEX_ROOT: wiki }, encoding: "utf8" });
  if (r.status !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`cortex export failed (${r.status}):\n${r.stdout}\n${r.stderr}`); }

  const server = staticServer(() => out);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  process.env.CORTEX_UI_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  return async () => {
    await new Promise((ok) => server.close(ok));
    rmSync(tmp, { recursive: true, force: true });
  };
}
