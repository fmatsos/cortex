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
run ls --json | grep Fermentation >/dev/null
run search fermentation --json | grep Fermentation >/dev/null
run lint --json >/dev/null || true # a fresh wiki has warnings; only a crash matters
run show Fermentation | grep "title: Fermentation" >/dev/null
run related Fermentation >/dev/null
run doctor >/dev/null
# the Linux binary carries sqlite-vec: it must load and answer a KNN query (no model is downloaded: embed is off here)
case "$bin" in *.js) ;; *) if [ "$(uname -s)" = Linux ]; then run doctor | grep "KNN ok" >/dev/null; fi ;; esac
run schema >/dev/null
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | run mcp | grep '"search"' >/dev/null
run export --out "$w/site" >/dev/null
test -f "$w/site/index.html"
# serve: the site is built by a child process of this same build (cortex export --out), then served; a second start serves that build at once
serve() { env -i HOME="$w/home" PATH="$path" CORTEX_ROOT="$w" CORTEX_REVIEWER=check "$bin" serve --port 0 >"$1" 2>&1 & pid=$!; }
listening() { for _ in $(seq 1 "$2"); do grep -q 'cortex serve: http' "$1" && return 0; sleep 1; done; return 1; }
serve "$w/serve1.log"; listening "$w/serve1.log" 180 || { cat "$w/serve1.log"; exit 1; }
port=$(sed -n '/^cortex serve: http/{s|^cortex serve: http://localhost:\([0-9]*\).*|\1|p;q;}' "$w/serve1.log")
curl -fsS "http://localhost:$port/" | grep -i '<html' >/dev/null
kill "$pid"; wait "$pid" || true
serve "$w/serve2.log"; listening "$w/serve2.log" 10 || { cat "$w/serve2.log"; exit 1; } # the previous build, without waiting for a new one
grep -q 'serving the build of' "$w/serve2.log"
port=$(sed -n '/^cortex serve: http/{s|^cortex serve: http://localhost:\([0-9]*\).*|\1|p;q;}' "$w/serve2.log")
curl -fsS "http://localhost:$port/" | grep -i '<html' >/dev/null
for _ in $(seq 1 180); do grep -q 'site rebuilt' "$w/serve2.log" && break; sleep 1; done # and the rebuild by the child follows
grep -q 'site rebuilt' "$w/serve2.log"
kill "$pid"; wait "$pid" || true
if pgrep -f "$w/.cortex/serve" >/dev/null; then echo "an export child outlived serve"; exit 1; fi
# a local embedding model configured but never downloaded: search stays on words (one warning on stderr), nothing is fetched
printf '{"embed":{"provider":"local"}}\n' > cortex.json
run search fermentation --json 2>/dev/null | grep Fermentation >/dev/null
test ! -e "$w/home/.cache/cortex/models" # and no model was downloaded
echo "build OK: $bin"
