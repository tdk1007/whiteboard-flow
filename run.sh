#!/usr/bin/env bash
# whiteboard-flow — build (if needed) and serve a board locally.
#   ./run.sh                       → board "default"
#   ./run.sh shell-review-app      → that board, opens a browser
#   ./run.sh shell-review-app --rebuild
set -euo pipefail
cd "$(dirname "$0")"

SLUG="${1:-default}"
[[ "${SLUG}" == --* ]] && SLUG="default"
REBUILD=0
for a in "$@"; do [[ "$a" == "--rebuild" ]] && REBUILD=1; done

PY="$(command -v python3.13 || command -v python3)"

[[ -d node_modules ]] || { echo "→ npm install"; npm install; }

# rebuild when dist is missing, forced, or any source is newer than the bundle
needs_build=0
if [[ ! -f dist/index.html || $REBUILD -eq 1 ]]; then
  needs_build=1
elif [[ -n "$(find src index.html vite.config.js package.json -newer dist/index.html 2>/dev/null | head -1)" ]]; then
  needs_build=1
fi
if [[ $needs_build -eq 1 ]]; then
  echo "→ npm run build"
  npm run build
fi

exec "$PY" server/serve.py --slug "$SLUG" --open
