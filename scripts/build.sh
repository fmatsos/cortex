#!/usr/bin/env bash
# Builds a distribution of cortex (after `bun install --frozen-lockfile --omit optional`):
#   scripts/build.sh binary <outfile>   single-file executable, bun included (bun build --compile)
#   scripts/build.sh bundle <outfile>   single JS file run by the user's own bun (#!/usr/bin/env bun)
# Both carry a small tarball of the sources (no node_modules): on the first `cortex export`, it is extracted to the
# user's cache, the locked dependencies are installed there, then cortex reruns itself on them, since Vite cannot
# run from inside a compiled binary or a bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
kind="${1:?usage: scripts/build.sh binary|bundle <outfile>}"
out="${2:?usage: scripts/build.sh binary|bundle <outfile>}"
mkdir -p build
tar -czf build/payload.tar.gz --exclude='src/*.test.ts' --exclude='site/.svelte-kit' --exclude='site/.export.lock' \
  --exclude='site/node_modules' package.json bun.lock tsconfig.json src site
printf 'export default "%s";\n' "$(base64 -w0 build/payload.tar.gz 2>/dev/null || base64 -i build/payload.tar.gz)" > build/payload.ts
case "$kind" in
  binary) bun build --compile --minify src/bin.ts --external vite --define CORTEX_DIST_BUILD='"binary"' --outfile "$out" ;;
  bundle)
    bun build --target bun --minify src/bin.ts --external vite --define CORTEX_DIST_BUILD='"bundle"' --outfile "$out"
    { echo '#!/usr/bin/env bun'; cat "$out"; } > "$out.tmp" && mv "$out.tmp" "$out" && chmod +x "$out" ;;
  *) echo "usage: scripts/build.sh binary|bundle <outfile>" >&2; exit 2 ;;
esac
