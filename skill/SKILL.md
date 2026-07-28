---
name: whiteboard
description: >-
  Explain a plan, architecture or flow as an editable infinite canvas of explainer
  cards, rendered 100% LOCALLY with no dependencies, then read the user's in-place
  markup back as feedback. Each card carries the idea twice — a standard explanation
  and a plain-english one that crossfades on a toggle — plus stat tiles, before/after
  panels, code, pitfalls, and questions the user answers inside the diagram. They
  drag cards, draw on them, drop sticky notes, relabel titles and strike things out;
  the board auto-saves to disk and Claude reads back exactly what they did. No build
  step, no CDN, no license key, no watermark, nothing leaves the Mac. Slash: /whiteboard.
---

# Whiteboard — a two-way explain-and-review loop

Claude writes a plan as **cards + edges** (no coordinates); the board lays it out,
routes the arrows so **no line crosses a card**, and serves it on `localhost`. The
user **marks it up in place** — drags cards, circles things with a pen, drops sticky
notes, answers the questions on the cards, relabels titles, strikes cards out. Every
change **auto-saves to disk**, and Claude **reads it back as typed feedback** (no
screenshot, no browser) and revises.

- **Skill files:** `~/.claude/skills/whiteboard/` (`app.html`, `serve.py`, `read_feedback.py`, `references/spec.md`)
- **Boards live at:** `~/whiteboards/<slug>/` — `board.json` (what Claude wrote) and
  `snapshot.json` (the live board incl. markup). Override root with `$WHITEBOARDS_DIR`.
- **Server:** on-demand localhost (default port 7830), auto-shuts down after ~1h idle,
  restarted/life-extended every run.
- **Zero dependencies.** `app.html` is self-contained vanilla JS — no React, no tldraw,
  no elkjs, no CDN. Boards render with the network off.

## What a card is

Not a box with a label — a small explainer. Each card can carry: a numbered badge, a
kind chip (`Input` / `Process` / `Screen` / `Output` / `Decision`), a build status dot,
the idea written **twice** (`std` and `simple`, crossfading on a per-card or global
toggle), stat tiles, a before/after panel, a code line, an amber **pitfall** callout,
a **choice** question the user answers in place, a **quiz** with feedback, and a
"Lives in `<file>`" footer. See `references/spec.md`.

That is the point of the tool: the diagram explains itself well enough that a
non-expert can review it, and the review happens *on* the explanation.

## When to use

Reach for a whiteboard when the user should **see how something works and argue with
it**: architecture and data flows, a migration plan, a pipeline with a decision you
need from them, onboarding someone into a system, before/after rearranging. Especially
good when the feedback is *spatial* ("this should point at that", a note pinned to a
box) or when you have a real **open question** to put in front of them.

Skip it for prose answers, a quick list, or a chart with axes (`/dataviz`). For a
document-style plan with block-level comments, `/visual-plan` is better; use this when
the review is a **canvas**.

## Workflow

1. **Write the board.** Create `~/whiteboards/<slug>/board.json` (short kebab slug) —
   read `references/spec.md` first. Cards carry **no x/y**: columns come from `stage`,
   heights are measured in the browser, edges route themselves.

   Three things to get right, because they are what makes the board worth opening:
   - **Write `simple` for every card**, as a genuinely different sentence.
   - **Put your actual open question in a `choice`** on a `key: true` card. That is how
     the user decides, and `read_feedback.py` tells you what they picked.
   - **Never put text on the canvas outside a card.** Edges carry no labels and stages
     print inside their cards — anything else gets orphaned the moment the user drags
     something. Say it in a card's `std`, not next to an arrow.

2. **Serve and open it:**
   ```bash
   python3 ~/.claude/skills/whiteboard/serve.py --slug <slug> --reseed --open
   ```
   Use `--reseed` whenever you've (re)written `board.json` — it clears stale markup and
   rebuilds. Prints the URL and opens it. Re-running is safe: it reuses the running
   server and re-stages the latest `app.html`.

3. **Tell the user what to do.** Point them at the toolbar and say the board saves
   itself: drag cards to rearrange (arrows follow live), **pen** or **highlighter** to
   circle and cross out, **note** to leave a comment anywhere, **new box** to add a
   card they think is missing, **eraser** to remove a mark, note or box — or to strike
   a card out, double-click a title to relabel it, and answer the questions on the
   cards. A "feedback saved ✓" pill confirms each change landed.
   Keys: `v` move, `p` pen, `h` highlighter, `n` note, `b` new box, `e` eraser,
   `f` fit, `s` toggle plain english.

4. **Read the markup back** when they say they're done — **off disk, no browser:**
   ```bash
   python3 ~/.claude/skills/whiteboard/read_feedback.py --slug <slug>
   ```
   Prints ANSWERED / KNOWLEDGE CHECK / NOTES / ADDED BOXES / DREW ON / MOVED /
   RELABELED / STRUCK OUT, plus **STILL OPEN** for any question they skipped. Marks,
   notes and added boxes are
   attributed to the nearest card by name, so it reads as feedback, not coordinates.
   `--json` for machine-readable; `--md` also writes `~/whiteboards/<slug>/feedback.md`.
   Act on it, update `board.json`, re-serve with `--reseed`. Repeat until they're happy.

5. **Hand off the URL + the `board.json` path** so they can reopen. A normal reopen (no
   `--reseed`) restores everything: markup, answers, drags, reading mode, pan and zoom.

## Notes & limits

- **Layout is automatic and live.** Columns re-space themselves when a card's height
  changes (plain-english toggle, revealed quiz feedback) via a `ResizeObserver`. A card
  the **user** has dragged is never moved again by layout — their position wins.
- **Dragging re-routes.** Unlike the old tldraw version, edges are recomputed on every
  drag frame, so lines follow the card. No `--reseed` needed just to clean up routes.
- **Solid vs dashed edge.** Solid = flows into (target is to the right). Dashed and
  faded = loops back — the target sits earlier in the flow, so the line drops into a
  return lane beneath the board. A key sits in the canvas's bottom-right corner.
- **Nothing is drawn on the canvas but boxes and arrows.** See "All text lives in a
  box" in `references/spec.md` — this is a hard rule, not a style preference.
- **Verifying a board is clean.** `window.__wb` exposes `{S, SPEC, LAY, boxOf, layout,
  applyPositions, snapshot}`. To assert the no-crossing invariant, walk every
  `#edgeLayer path` with `getPointAtLength` and clip each segment against every card's
  `boxOf(id)` rect — expect zero intersections. Worth doing after touching layout code.
  The guarantee covers the **generated** layout only: the router is orthogonal with no
  obstacle avoidance, so a card the user drags into the middle of somebody else's edge
  will be crossed. That is the right trade — their position wins — but don't claim more.
- **Multi-port, never trunked.** A card is not a single connector: its outgoing edges
  stack down the right side and its incoming edges stack down the left, `PORT_GAP`
  apart, each stack ordered by where the far end sits vertically so lines don't cross
  on the way out. Every edge then gets its own vertical channel (`CHANNEL_GAP`) and,
  if it bypasses, its own row (`LANE_GAP`). No two edges share a channel. Spacing is
  tight on purpose — distinct enough to trace one line by eye, close enough that a
  bundle still reads as one flow. A trunked variant (all edges collapsed onto shared
  channels) was tried and rejected: it made individual connections unreadable.
- **Left is input, right is output — no exceptions.** Every edge leaves from its
  source's right side and arrives on its target's left side, including return edges.
  A return therefore steps out to the *right*, drops to its row, runs back under the
  board and climbs the gutter to the *left* of its target. Exiting leftward is shorter
  but reads as something coming out of the card's input, which is wrong.
- **Bypass lanes run in the gutters.** Back and long edges put their verticals in the
  empty column gutter, never down a column's centre line — that spears whatever is
  stacked below. `COL_PITCH - CW` is the gutter budget; shrink it and routes hit cards.
- **Freehand strokes carry no text.** If the user only scribbles, the digest can say
  *what* they drew on but not what they meant — ask them to add a typed note, or grab a
  small cropped PNG of that region.
- **You cannot fully self-test with synthetic events.** Focus behaviour differs, and
  `computer` clicks are dropped when the tab is not the visible one
  (`document.visibilityState === 'hidden'`) — a click that "does nothing" is usually
  that, not a bug. To test `read_feedback.py`, mutate a copy of `snapshot.json` on disk
  and point `$WHITEBOARDS_DIR` at it.
- **Localhost only.** The save-back POSTs to `/save/<slug>` on the local server; opening
  `index.html` off the filesystem renders but cannot save.
- **Legacy boards** in the old `nodes`/`edges` format still load as title-only cards
  (see `references/spec.md`). An old tldraw `snapshot.json` is refused with a message
  telling you to `--reseed`.
- **Example board:** `~/whiteboards/system-explainer/board.json` — a 12-card board that
  exercises every block type. Copy it as a starting point.
- **Design origin:** the card, canvas and toolbar design is the "System Explainer"
  Claude Design (project `913712b0-8abe-4d0a-9638-f5f3c1ab53dd`), reimplemented as
  dependency-free vanilla JS. Its palette lives in the `:root` custom properties at the
  top of `app.html` — change colours there, not inline.
- **Teardown:** `bash ~/.claude/skills/whiteboard/uninstall.sh` (stops the server;
  `--purge` also removes `~/whiteboards`). See `MANIFEST.md`.
