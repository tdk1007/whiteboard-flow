#!/usr/bin/env bash
# Teardown for the whiteboard skill.
#   bash uninstall.sh           # stop the running server
#   bash uninstall.sh --purge   # also delete ~/whiteboards (all boards)
set -euo pipefail

ROOT="${WHITEBOARDS_DIR:-$HOME/whiteboards}"
PIDFILE="$ROOT/.server.pid"

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "Stopped whiteboard server (pid $PID)."
  else
    echo "No live server for pid ${PID:-?}."
  fi
  rm -f "$PIDFILE"
else
  echo "No server pidfile found."
fi

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$ROOT"
  echo "Removed $ROOT (all boards deleted)."
else
  echo "Boards kept at $ROOT. Re-run with --purge to delete them."
fi

echo "To remove the skill itself: rm -rf ~/.claude/skills/whiteboard"
