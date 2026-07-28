# Whiteboard skill — manifest

Everything this skill installs, for clean teardown.

## Skill files (backed up to GitHub via the skills auto-backup hook)
- `~/.claude/skills/whiteboard/SKILL.md`
- `~/.claude/skills/whiteboard/app.html`         — the whole board: layout, edge router, card renderer, markup tools, autosave (self-contained, no deps)
- `~/.claude/skills/whiteboard/serve.py`         — on-demand localhost server; GET + POST /save/<slug>; idle auto-shutdown
- `~/.claude/skills/whiteboard/read_feedback.py` — reads snapshot.json vs board.json → the user's markup as typed feedback
- `~/.claude/skills/whiteboard/references/spec.md`
- `~/.claude/skills/whiteboard/MANIFEST.md`      — this file
- `~/.claude/skills/whiteboard/uninstall.sh`

## Runtime state (NOT backed up — user content)
- `~/whiteboards/<slug>/board.json`   — each board's spec / plan (authored by Claude)
- `~/whiteboards/<slug>/snapshot.json`— live board incl. user markup (auto-saved via POST)
- `~/whiteboards/<slug>/feedback.md`  — written only by `read_feedback.py --md`
- `~/whiteboards/<slug>/index.html`   — copy of app.html, re-staged each run
- `~/whiteboards/.server.pid`         — running server pid
- `~/whiteboards/.server.log`         — detached server log
- `~/whiteboards/system-explainer/`   — example board shipped as a reference; safe to delete

## Runtime process
- One detached `python3 serve.py --serve` process, listening on 127.0.0.1:7830
  (override via `$WHITEBOARD_PORT`). Serves boards (GET) and accepts snapshot
  save-backs (POST /save/<slug>). Self-terminates after ~1h with no requests.

## External dependencies
- **None, at install time or at view time.** `app.html` is a single self-contained file
  (vanilla JS + inline CSS): no npm, no node_modules, no build step, and no CDN fetch —
  the previous tldraw/react/elkjs esm.sh imports are gone, so boards render offline.
- Python: stdlib only (3.9+).

## Teardown
`bash ~/.claude/skills/whiteboard/uninstall.sh` — kills the server and (with `--purge`)
removes `~/whiteboards`. Removing the skill dir itself is a manual `rm -rf`.
