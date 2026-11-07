import { expect, test } from "bun:test";
import { usage } from "./backends/policy";

test("usage: the agent is shown the --help lines of its allowed commands only", () => {
  const read = usage("read");
  expect(read).toContain("cortex search \"<query>\"");
  expect(read).toContain("--limit N");
  expect(read).not.toContain("cortex log add");
  expect(read).not.toContain("cortex index");
  expect(usage("write")).toContain("cortex log add");
  expect(usage("write")).not.toContain("cortex add");
});

test("guard: a refused shell command points to the tool to use instead", async () => {
  const { guard } = await import("./backends/claude");
  const why = (cmd: string) => (guard("/w", "Bash", { command: cmd }, "write") as { reason: string }).reason;
  expect(why("ls wiki/concepts/*.md 2>/dev/null | head -20")).toContain("Glob tool");
  expect(why("rm wiki/sources/x.md")).toContain("not allowed: fix the page with Edit or Write");
  expect(why("cat wiki/index.md")).toContain("Read tool");
});
