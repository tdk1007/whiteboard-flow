# whiteboard-flow — spike

A second take on `/whiteboard`, built on **Svelte Flow** (`@xyflow/svelte`) instead of
tldraw, to test one idea:

> **Reviewer feedback should be typed data, not shapes an agent has to interpret.**

The tldraw board is a free-form canvas — you drag boxes and drop sticky notes, and
`read_feedback.py` *diffs* the canvas against the plan to guess what you meant
(ADDED / MOVED / RELABELED / DELETED). It works, but intent is inferred.

Here the board is a **structured review surface**. Every box carries a verdict
(**Do first / Keep / Change / Cut**) and a comment. Those, plus proposed work,
proposed connections, and answers to the board's open questions, land in
`feedback.json` as a typed object. `read_feedback.py` renders it as a **steering
digest** ending in an **ACTION CONTRACT** — an ordered directive the agent applies.
Nothing is guessed.

Side effect worth noting: **Svelte Flow is MIT.** No license key, no watermark, no
dev-vs-production mode. The tldraw skill is pinned to `localhost` because HTTPS on a
real hostname flips it into production mode and needs a paid licence — the open
question blocking the rivctl fork. That constraint does not exist here.

## Run

```bash
./run.sh shell-review-app          # builds if needed, serves, opens the board
./run.sh shell-review-app --rebuild
```

→ `http://127.0.0.1:7840/?slug=shell-review-app`

Read the review back — **no browser needed**, this reads `feedback.json` off disk:

```bash
python3 server/read_feedback.py --slug shell-review-app
python3 server/read_feedback.py --slug shell-review-app --md    # also writes feedback.md
python3 server/read_feedback.py --slug shell-review-app --json  # machine-readable
```

Start a fresh review (the old one is kept as `feedback.json.bak`):

```bash
python3 server/serve.py --slug shell-review-app --reset --open
```

## How you review

| Action | What it records |
|---|---|
| Click a box | opens it in the review panel |
| `1` `2` `3` `4` | Do first · Keep · Change · Cut (also the ▲✓✎✕ chips on box hover) |
| Type in the comment box | the free text that actually steers the work |
| `n` | jump to the next unreviewed box (camera follows) |
| Double-click empty canvas | propose a new piece of work |
| Drag box edge → box edge | propose a connection the plan is missing |
| Click a line | say what's wrong with that dependency |
| Answer the open questions | marks them decided so the agent stops asking |
| General direction | anything that isn't about one box |

Everything autosaves (~500 ms debounce); the top bar shows **feedback saved ✓**.

## Files

```
src/lib/layout.js          ELK layout + orthogonal routes + back-edge detection
src/lib/feedback.svelte.js the typed feedback store (Svelte 5 runes) + autosave
src/Board.svelte           canvas, two-pass measure, selection, camera, keyboard
src/nodes/PlanNode.svelte  a plan box + its verdict state
src/nodes/ProposedNode.svelte  reviewer-authored box
src/edges/RoutedEdge.svelte    ELK polyline + self-drawn arrowhead + verdict marker
src/panels/ReviewPanel.svelte  the review surface (node / edge / board level)
server/serve.py            static host + GET /api/board + POST /api/feedback
server/read_feedback.py    the steering digest
boards/<slug>/board.json   the plan (logical graph, no coordinates)
boards/<slug>/feedback.json  the review (written by the board)
```

## board.json

Same coordinate-free logical graph as the tldraw skill, plus review-oriented fields:

```jsonc
{
  "title": "...",
  "subtitle": "...",
  "direction": "RIGHT",              // or "DOWN"
  "nodes": [
    { "id": "seed", "text": "Workbook parse\n+ merge",
      "kind": "component",           // component | work | data | external | decision | ui
      "status": "done",              // done | active | planned | risk | blocked
      "detail": "one or two lines of context",
      "file": "seed.py",             // optional, rendered monospace
      "group": "Ingest" }            // same string ⇒ same frame
  ],
  "edges": [{ "from": "seed", "to": "db", "text": "merge", "kind": "data" }],
  "questions": ["the decisions you want made"]   // rendered as answerable cards
}
```

`detail` is clamped to two lines on the canvas and shown in full in the panel, so
long context doesn't blow the layout out.

## Design notes / things learned

- **ELK owns layout and routing, not Svelte Flow.** Svelte Flow's built-in edges
  (bezier/smoothstep) cut straight through boxes. Edges are rendered from ELK's
  computed orthogonal routes as a custom `routed` edge instead. Audited on the
  sample board: **0 intersections across 21 edges and 18 boxes.**
- **Two-pass measure.** Box height depends on how the browser wraps the label, so
  laying out against guessed sizes puts route origins *inside* boxes. The board
  renders once hidden, measures real DOM sizes, then runs ELK against the truth.
  (Same failure the tldraw build hit via `growY`.)
- **Back edges are drawn differently.** A route that ends behind where it started
  (`queue → decide`, `decide → db`) gets sent by ELK on a long detour around the
  whole graph, which reads as a stray rectangle. Those are detected geometrically
  and drawn dimmed + dotted, so they recede into "return path".
- **Timers, not `requestAnimationFrame`.** rAF is suspended in a background tab, so
  an rAF-driven measure loop leaves the board stuck on "laying out…" forever for
  anyone who opens a board and switches away.
- **Routes are static** (same tradeoff as the tldraw build). Dragging a box does not
  re-route its lines — hit **Re-layout**. Proposed edges are the exception: they use
  a live smoothstep path, so they follow drags.
- **`window.__wbflow`** is exposed for scripting: `.board .nodes .edges .feedback
  .layout`, `.connect(a,b)`, `.select(id)`, `.focus(id)`, `.relayout()`, `.save()`.
- **Automation caveat:** Svelte Flow leaves nodes `visibility: hidden` until its
  ResizeObserver has measured them, which doesn't happen in a background tab — so
  handles aren't hit-testable there. Use `__wbflow.connect()` to script connections.

## Status

Verified end-to-end in Chrome: layout, 0-overlap routing, node verdicts, comments,
keyboard, camera-follow, proposing a node, proposing a connection, autosave to
`feedback.json`, and the digest. The pointer-level handle **drag** was verified only
through `__wbflow.connect()` — the drag itself is stock Svelte Flow behaviour but
could not be driven in a backgrounded automation tab.

Not done: multi-reviewer/persistent store, offline vendoring of the bundle
(`elkjs` + Svelte Flow are bundled locally, but it's a 1.7 MB build), and any
decision about whether this replaces `/whiteboard` or ships beside it.
