import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pruneModules, pruneOldPayloads } from "./payload";

test("pruneModules keeps what runs here and drops the other platforms, maps, declarations and tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-prune-"));
  const files = [
    "onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1", "onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
    "onnxruntime-node/bin/napi-v6/linux/arm64/libonnxruntime.so.1", "onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib",
    "onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll", "onnxruntime-node/dist/index.js",
    "pkg/index.js", "pkg/index.js.map", "pkg/index.d.ts", "pkg/index.d.mts", "pkg/test/a.js", "pkg/dist/__tests__/b.js", "pkg/src/tests/c.ts", ".bin/pkg",
  ];
  try {
    for (const f of files) { mkdirSync(dirname(join(dir, "node_modules", f)), { recursive: true }); writeFileSync(join(dir, "node_modules", f), "x"); }
    pruneModules(dir, "linux", "x64");
    const left = files.filter((f) => existsSync(join(dir, "node_modules", f)));
    expect(left).toEqual([
      "onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1", "onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
      "onnxruntime-node/dist/index.js", "pkg/index.js", ".bin/pkg",
    ]);
    pruneModules(dir, "darwin", "arm64"); // nothing more to drop for another platform once its folder is gone: no error
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pruneOldPayloads drops the earlier payloads and abandoned extractions, never the other caches (models/, native/)", () => {
  const base = mkdtempSync(join(tmpdir(), "cortex-cache-"));
  const dirs = ["0.17.1-0123456789ab", "0.17.2-aaaaaaaaaaaa", "0.17.3-bbbbbbbbbbbb", "0.17.3-bbbbbbbbbbbb.tmp-42", "0.17.0-cccccccccccc.tmp-7", "models", "native", "native/vec0-123", "models/e5", "other-cache"];
  try {
    for (const d of dirs) mkdirSync(join(base, d), { recursive: true });
    writeFileSync(join(base, "models/e5/model.onnx"), "x");
    const old = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(base, "0.17.0-cccccccccccc.tmp-7"), old, old);
    pruneOldPayloads(base, "0.17.3-bbbbbbbbbbbb");
    expect(readdirSync(base).sort()).toEqual(["0.17.3-bbbbbbbbbbbb", "0.17.3-bbbbbbbbbbbb.tmp-42", "models", "native", "other-cache"]);
    expect(existsSync(join(base, "models/e5/model.onnx"))).toBe(true);
    expect(existsSync(join(base, "native/vec0-123"))).toBe(true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
