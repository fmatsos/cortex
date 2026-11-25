#!/usr/bin/env bash
# Builds a distribution of cortex (after `bun install --frozen-lockfile --omit optional`):
#   scripts/build.sh binary <outfile>   single-file executable, bun included (bun build --compile)
#   scripts/build.sh bundle <outfile>   single JS file run by the user's own bun (#!/usr/bin/env bun)
# The binary also embeds the native libraries of its platform (sqlite-vec; the ONNX runtime of the local embedding model): build/native.ts,
# generated below like build/payload.ts, lists them and src/native.ts extracts them to the user's cache on first use. The bundle has
# none (no node_modules next to it): search then runs its nearest neighbours in JS and, for the local model, falls back to words only.
# Both carry a small tarball of the sources (no node_modules): on the first `cortex export`, it is extracted to the
# user's cache, the locked dependencies are installed there, then cortex reruns itself on them, since Vite cannot
# run from inside a compiled binary or a bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
kind="${1:?usage: scripts/build.sh binary|bundle <outfile>}"
out="${2:?usage: scripts/build.sh binary|bundle <outfile>}"
mkdir -p build
tar -czf build/payload.tar.gz --exclude='src/*.test.ts' --exclude='site/.svelte-kit' --exclude='site/.export.lock' \
  --exclude='site/node_modules' --exclude='extension/*.test.ts' --exclude='extension/node_modules' --exclude='extension/dist' \
  package.json bun.lock tsconfig.json src site design scripts/share-server.ts scripts/bookmarklet.ts extension assets/logo/cortex-192.png assets/logo/cortex-512.png
printf 'export default "%s";\n' "$(base64 -w0 build/payload.tar.gz 2>/dev/null || base64 -i build/payload.tar.gz)" > build/payload.ts
# build/native.ts: the native files of this platform as embedded files (`with { type: "file" }`); `{}` where there is none to carry.
ort=onnxruntime-node/bin/napi-v6
case "$kind-$(uname -s)-$(uname -m)" in
  binary-Linux-x86_64) cat > build/native.ts <<EOF
// @ts-nocheck
import vec from "sqlite-vec-linux-x64/vec0.so" with { type: "file" };
import ort from "$ort/linux/x64/libonnxruntime.so.1" with { type: "file" };
export default { vec, vecName: "vec0.so", ort, ortName: "libonnxruntime.so.1" };
EOF
  ;;
  binary-Darwin-arm64) cat > build/native.ts <<EOF
// @ts-nocheck
import vec from "sqlite-vec-darwin-arm64/vec0.dylib" with { type: "file" };
import ort from "$ort/darwin/arm64/libonnxruntime.1.dylib" with { type: "file" };
export default { vec, vecName: "vec0.dylib", ort, ortName: "libonnxruntime.1.dylib" };
EOF
  ;;
  *) echo 'export default {};' > build/native.ts ;;
esac
# sqlite-vec is loaded from node_modules when not embedded (never in the binary); sharp is the stub of tsconfig.json
case "$kind" in
  binary) bun build --compile --minify src/bin.ts --external vite --external sqlite-vec --define CORTEX_DIST_BUILD='"binary"' --outfile "$out" ;;
  bundle)
    bun build --target bun --minify src/bin.ts --external vite --external sqlite-vec --external @huggingface/transformers --external onnxruntime-node --define CORTEX_DIST_BUILD='"bundle"' --outfile "$out"
    { echo '#!/usr/bin/env bun'; cat "$out"; } > "$out.tmp" && mv "$out.tmp" "$out" && chmod +x "$out" ;;
  *) echo "usage: scripts/build.sh binary|bundle <outfile>" >&2; exit 2 ;;
esac
