#!/usr/bin/env bash
# Builds the single-file binary: `scripts/build.sh <outfile>` (after `bun install --frozen-lockfile --omit optional`).
# The binary carries a small tarball of the sources (no node_modules): on the first `cortex export`, it extracts them to
# the user's cache, installs the locked dependencies there with its own bun (BUN_BE_BUN=1), then reruns itself on them,
# since Vite cannot run from inside a compiled binary.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?usage: scripts/build.sh <outfile>}"
mkdir -p build
tar -czf build/payload.tar.gz --exclude='src/*.test.ts' --exclude='site/.svelte-kit' --exclude='site/.export.lock' \
  --exclude='site/node_modules' package.json bun.lock tsconfig.json src site
bun build --compile --minify src/bin.ts --external vite --outfile "$out"
