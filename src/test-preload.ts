import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Loaded before every test file (bunfig.toml): the user's ~/.config/cortex/remotes.json must never be read, or a test
// running cortex outside a wiki would forward its command over ssh to the real wiki. Spawned cortex inherit process.env.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "cortex-xdg-"));
delete process.env.CORTEX_WIKI;
