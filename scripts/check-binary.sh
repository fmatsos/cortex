#!/usr/bin/env bash
# Smoke test of a build, alone (empty HOME and cache): `scripts/check-binary.sh <binary or cortex.js>`.
# The binary runs with no bun in PATH; cortex.js gets only the directory of the bun running this script.
# Run by the release workflow before publishing. The export needs the network once (it installs the site's dependencies).
set -euo pipefail
bin="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$(dirname "$0")/../package.json")
w=$(mktemp -d)
path=/usr/bin:/bin
case "$bin" in *.js) path="$(dirname "$(command -v bun)"):$path" ;; esac
run() { env -i HOME="$w/home" PATH="$path" CORTEX_ROOT="$w" "$bin" "$@"; }
cd "$w"
run --help >/dev/null
test "$(run --version)" = "$version"
run config init >/dev/null
echo "# Fermentation lactique" | run add - --note "test" >/dev/null
p=$(run new Concept "Fermentation")
perl -pi -e 's/^type: Concept$/type: Concept\ntags: [test]/' "$p"
run index >/dev/null
run ls --json | grep -q Fermentation
run search fermentation --json | grep -q Fermentation
run lint --json >/dev/null || true # a fresh wiki has warnings; only a crash matters
run show Fermentation | grep -q "title: Fermentation"
run related Fermentation >/dev/null
run doctor >/dev/null
run schema >/dev/null
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | run mcp | grep -q '"search"'
run export --out "$w/site" >/dev/null
test -f "$w/site/index.html"
echo "build OK: $bin"
