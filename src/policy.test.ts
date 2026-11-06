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
