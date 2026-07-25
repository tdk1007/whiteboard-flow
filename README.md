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

## …or just draw on it

The panel is the precise way to review. The toolbar down the left is the fast one —
the thing you'd actually do at a whiteboard.

| Tool | Key | What it's for | What the agent gets |
|---|---|---|---|
| Select | `v` | click a box, drag it, drag handles to connect | — |
| Pan | `h` | drag anywhere to move the board; nothing else moves | — |
| Pen | `p` | circle it, cross it out, sketch | *"1 pen mark over Decision engine"* |
| Highlighter | `m` | wide translucent emphasis | *"1 highlighter mark over Path associations"* |
| Text | `t` | click anywhere, type a note | the note, filed **under the box it sits on** |
| Box | `b` | drag out your own box, name it | a proposed piece of work (same as double-click) |
| Region | `r` | ring a whole cluster | *"treat these as one unit: Queue, Deck, Validation"* |
| Arrow | `a` | point from one box to another — **swing it** and it keeps the curve | *"Export → Path associations"*, and a contract step |
| Eraser | `e` | click or drag over markup | — |

`⌘Z` undoes drawing, and only drawing — verdicts and comments are deliberate
single clicks and are never silently reversed. Colour picker appears while a
drawing tool is active; **clear N** removes all markup (undoable).

**Arrows curve the way you drag them.** A straight line can't get around the
boxes in between, so the arrow tool fits a cubic Bézier to the path your pointer
actually travelled — swing it wide and it stays swung. Hold **shift** to snap it
straight. The endpoints are pinned through the fit, so a curved arrow still
resolves to *"X → Y"* exactly like a straight one; the curve is presentation and
the meaning is unchanged.

**Freehand is not decoration — it's typed data.** Every mark records which plan
boxes it covers (`anchors`) at the moment you draw it, so `read_feedback.py` can
say *what the scribble was about* instead of dumping coordinates. A note dropped
on a box is reported as that box's comment. An arrow between two boxes is
resolved to their names, checked against the plan's existing edges, and — if it's
genuinely new — promoted into the action contract.

Marks also record the position of their anchor box (`origin`). When the layout
moves — a re-layout, a longer label, or the agent rewriting `board.json` between
rounds — every mark is re-seated onto its box. A circle drawn around the decision
engine stays around the decision engine.

## Files

```
src/lib/layout.js          ELK layout + orthogonal routes + back-edge detection
src/lib/ink.js             freehand geometry: smoothing, RDP, anchoring, hit tests
src/lib/feedback.svelte.js the typed feedback store (Svelte 5 runes) + autosave + undo
src/Board.svelte           canvas, two-pass measure, selection, camera, keyboard, drawing
src/canvas/DrawToolbar.svelte  tool + colour picker
src/canvas/MarkLayer.svelte    renders marks inside the flow viewport
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

## feedback.json

Written by the board, read by `read_feedback.py`. Verdicts and comments are keyed
by node/edge id; freehand lives in `marks`:

```jsonc
{
  "nodes": { "paths": { "verdict": "first", "comment": "…" } },
  "proposedNodes": [{ "id": "prop-1", "text": "…", "comment": "…" }],
  "proposedEdges": [{ "id": "pe-a->b", "from": "a", "to": "b" }],
  "marks": [
    { "id": "mk-pen-6", "type": "ink", "points": [[1121.9, 769.7], …],
      "color": "#c77dff", "width": 3, "highlight": false,
      "anchors": ["decide"],                    // plan boxes this covers
      "origin": { "id": "decide", "x": 900, "y": 640 } },  // where that box was
    { "type": "text", "x": 1882, "y": 1024.5, "text": "who owns this?", "anchors": ["deploy"] },
    { "type": "arrow", "from": [x, y], "to": [x, y], "hitFrom": "export", "hitTo": "paths",
      "c1": [x, y], "c2": [x, y] },        // cubic control points; absent ⇒ straight
    { "type": "region", "x": 0, "y": 0, "w": 276, "h": 495, "anchors": ["queue", "deck"] }
  ],
  "answers": { "0": "…" },
  "general": "…"
}
```

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
- **Screen→flow coordinates come from the transform on screen**, not from the
  `viewport` state. Selecting a box glides the camera for 260 ms, and during that
  glide the state already holds the destination — anything drawn mid-glide was
  being committed at coordinates the reviewer never saw. `flowPos()` reads the
  live `DOMMatrix` off `.svelte-flow__viewport` instead, and the camera doesn't
  animate at all while a drawing tool is up.
- **The mark SVG must be a real sized box.** A `0×0 <svg>` with `overflow:
  visible` *looks* like it works — the elements are in the DOM and
  `getBoundingClientRect()` on the paths returns correct geometry — but Chrome
  never paints it. Every stroke was invisible while the data underneath was
  perfectly fine. The layer now sizes itself to the marks it holds with a matching
  `viewBox`, which keeps SVG user units equal to flow coordinates.
  **Testing lesson:** `getBoundingClientRect()` proves layout, not paint — and
  `elementsFromPoint` can't stand in for it either, because the whole mark layer
  is `pointer-events: none` and hit testing therefore looks straight through it.
  The only honest check is pixels: screenshot the region and look.
- **A curved arrow is fitted, not invented.** The arrow tool records the path the
  pointer travelled and least-squares fits a cubic Bézier to it, with both
  endpoints pinned so the ends still resolve to "X → Y". Chord-length
  parameterisation alone fits a smooth arch worse than eyeballing it would
  (13 px off a 400 px arrow); alternating the solve with Newton reparameterisation
  of each sample's `t` gets that to ~1 px, and the whole fit is ~17 µs, so it runs
  live on every `pointermove` and you see the curve you're going to get. Below a
  length-relative bow threshold it stores no control points at all, which is both
  how shift-to-snap-straight works and why arrows drawn before curves existed
  render unchanged.
- **Seed id counters from existing ids, never from `.length`.** Deleting a mark
  and drawing a new one reused a live id, and a duplicate key in an `{#each}` is
  fatal in Svelte — it takes the whole board down rather than dropping one mark.
  The store also de-duplicates on load, so a bad `feedback.json` can't brick it.
- **Marks are anchored, not just positioned.** Storing flow coordinates alone is
  a trap: the layout moves whenever anything changes (even naming a proposed box
  re-flows the graph and strands every mark). Each mark keeps the position of its
  anchor box, and `reconcileMarks()` re-seats it after every layout.
- **`window.__wbflow`** is exposed for scripting: `.board .nodes .edges .feedback
  .marks .boxes .layout`, `.connect(a,b)`, `.select(id)`, `.focus(id)`,
  `.relayout()`, `.save()`, plus the drawing API — `.tool(name)`, `.color(hex)`,
  `.ink(points)`, `.arrow(from,to,{bow})`, `.arrowFit(points)`, `.region(x,y,w,h)`,
  `.note(x,y,text)`, `.erase(x,y)`, `.clearMarks()`, `.undo()`.
  Note `.tool()` is idempotent, unlike the toolbar button it stands in for:
  clicking the tool you're already holding toggles back to select, which is right
  for a mouse and wrong for a script — it silently made every other scripted drag
  a no-op until `.tool()` stopped inheriting the toggle.
- **Automation caveat:** Svelte Flow leaves nodes `visibility: hidden` until its
  ResizeObserver has measured them, which doesn't happen in a background tab — so
  handles aren't hit-testable there. Use `__wbflow.connect()` to script connections.
  Chrome also *freezes* a backgrounded tab within about a minute: `setTimeout`,
  `fetch` and `requestAnimationFrame` all stop, so autosaves queue up and only
  fly when the tab comes back. Synthetic `PointerEvent`s dispatched at `.pane`
  still drive the real drawing handlers, and Svelte flushes on a microtask, so
  `await Promise.resolve()` is the way to wait for the DOM in a frozen tab.

## Status

Verified end-to-end in Chrome: layout, 0-overlap routing, node verdicts, comments,
keyboard, camera-follow, proposing a node, proposing a connection, autosave to
`feedback.json`, and the digest.

Drawing verified with pointer events dispatched at a **descendant** of the pane
(the path real input takes — dispatching at `.pane` itself lets a capture handler
fire "at target" and hides propagation bugs): pen, highlighter, text notes,
region, arrow, box, eraser, `⌘Z`, the colour picker, persistence, and
reload-from-disk. Mark geometry checked against live box rects — the pen ring
encloses its box, the region encloses all four boxes it was drawn around, the
note sits inside the box it names — and paint verified by screenshot.

Modes verified by driving real mouse gestures: in **pan** a drag starting on top of
a box moves the camera 1:1 (80 px dragged → 80 px moved, zoom held) and leaves the
box where it was, clicking a box doesn't change what's under review, and
double-click proposes nothing; in **select** the same drag moves the box and
leaves the camera alone. `esc` and a second `h` both return to select.

Curved arrows: fit accuracy measured against four synthetic gestures (arc, sine
arch, S-curve, arc + hand jitter) at 0.3–0.7 % of arrow length; endpoints pinned;
a jittery straight drag and a shift-held bowed drag both stay straight; bounds
grow to contain the bow; the eraser catches the curve 571 px off its own chord;
the arrowhead sits 2° off the stroke's arrival angle where using the chord would
have been 54° off; control points survive translation, so a curve re-seats with
its shape intact; and the digest reads a curved arrow as the same "X → Y" as a
straight one.

The pointer-level handle **drag** for proposing a connection is still verified
only through `__wbflow.connect()` (see the automation caveat above).

Not done: multi-reviewer/persistent store, offline vendoring of the bundle
(`elkjs` + Svelte Flow are bundled locally, but it's a 1.7 MB build), and any
decision about whether this replaces `/whiteboard` or ships beside it.
