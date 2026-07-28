# Whiteboard spec format (`board.json`)

A board is one JSON object: a list of **cards** and the **edges** between them.

**You do not set coordinates.** A card's column comes from the order its `stage`
label first appears; within a column, cards stack in declaration order, and each
column's stack is centred on a shared axis. Card heights are *measured in the
browser* after render, so a column re-spaces itself whenever a card grows (a longer
plain-english body, a revealed quiz answer). Edges are routed orthogonally with
rounded corners (a **smoothstep** route — orthogonal segments, no diagonals, corners
arced at 16px), and lanes are chosen automatically — forward, a bottom bypass lane
for a long jump, or a dashed return lane for a backward edge. Each card carries
**multiple ports**: outgoing edges stack down its right side, incoming edges down its
left, and every edge gets its own vertical channel, so no two lines are ever laid on
top of each other. **No line crosses a card in the generated layout** (bypass lanes
run in the empty gutters between columns). Once the *user* drags a card, their
position wins and is never re-laid-out, so they can park a card on top of an edge —
that is accepted.

Unknown fields are ignored. An edge naming a card that does not exist is dropped
with a note on the board, never an error.

```jsonc
{
  "title":    "Import pipeline — how the system works",       // header line + tab title
  "subtitle": "mark it up, then send the notes back",          // header sub-line (optional)
  "accent":   "#5aa2ff",       // highlight for `key` cards + the Copy button (optional)
  "defaultMode": "standard",   // "standard" | "simple" — which body text shows first

  "cards": [
    {
      "id":    "seed",                      // unique; edges reference this
      "stage": "Fold it in",                // column label — cards sharing it share a column
      "kind":  "Process",                   // free-text chip: Input / Process / Data / Screen / Output / Decision …
      "status":"done",                      // "done" | "in flight" | "open" — colours the dot
      "file":  "seed.py",                   // shown in the card footer as "Lives in <file>"
      "key":   false,                       // true = accent border + accent badge (the card that matters)
      "n":     3,                            // badge number (defaults to position)

      "title":  "Parse and merge, without losing decisions",
      "std":    "The full explanation, for someone who knows the system.",
      "simple": "The same thing in plain english, for someone who does not.",

      // --- optional blocks, all independent; include only what earns its space ---

      "stats": [                            // up to ~3 tiles; more will squeeze
        { "v": "1,500", "k": "source rows" }
      ],

      "ba": {                               // before → after, side by side
        "aLabel": "A plain import would", "a": "Drop the row that vanished.",
        "bLabel": "This one does",         "b": "Keep it and flag it as absent."
      },

      "code": "journal_mode = DELETE   # never WAL on EFS",   // one-liner or short block

      "pitfall": {                          // amber-labelled warning, crossfades with the mode
        "std":    "The precise failure mode.",
        "simple": "The same warning in plain english."
      },

      "choice": {                           // a question you want the USER to answer
        "q": "Which lands first?",
        "options": [
          { "label": "Path associations", "r": "Reply shown once they pick this." }
        ]
      },

      "quiz": {                             // a comprehension check with a right answer
        "q": "Which action needs a second pass?",
        "options": ["Keep", "Repoint", "Retire", "Delete"],
        "correct": 3,                       // 0-based index
        "right": "Right. Delete is the only one.",
        "wrong": "Not quite — Delete is the one with the second pass."
      }
    }
  ],

  "edges": [
    { "from": "seed", "to": "db" }
    // "lane": "auto" (default) | "fwd" | "long" | "back" — only set it to override
    // NO label field. Edges are unlabelled by design — see "All text lives in a
    // box" below. A `text` key is accepted and silently ignored.
  ]
}
```

## All text lives in a box

Nothing but **cards, user boxes, sticky notes and the edges between them** is ever
painted on the canvas. There are no edge labels and no floating column headings.

The reason is the review loop: the moment the user drags a card, any text that was
positioned relative to that card — or to the line leaving it — is orphaned, and the
board reads as a mess of stranded words. So:

- **Edges carry no text.** If an edge needs explaining, the explanation belongs in
  the `std` of one of the two cards it joins. "This only fires for deletes" is a
  sentence about the card, not about the arrow.
- **`stage` is rendered inside each card** as a small uppercase eyebrow above the
  title, so the column's name travels with the card when it moves.
- **Sticky notes and user boxes are exempt** — they *are* boxes, they are the
  user's, and they are meant to be dragged around.

## Reading the edges

A card's **left side is its input and its right side is its output**. Every edge
obeys that: it leaves from the source's right and arrives at the target's left, no
matter which direction it travels.

- **Solid line** — flows into. The target is to the right: the normal forward step.
- **Dashed, faded line** — loops back. The target sits to the *left* of the source,
  so the edge steps out to the right, drops into a return lane under the board, runs
  back across, and climbs into the target's left side. Use it for retries,
  write-backs, version checks, live re-renders — anything that feeds an earlier
  stage. The board shows this key in the bottom-right corner.

## Authoring guidance

- **One idea per card.** The `title` is the claim; `std` is why it is true. If a card
  needs three paragraphs, it is two cards.
- **`simple` is not optional in practice.** It is what makes the board readable by
  someone who does not know the system. Write it as a different sentence, not a
  shortened one — the two crossfade in place, so they should be the same *point* at
  two altitudes. Omit it and the plain-english toggle shows `std` unchanged.
- **`stage` is the spine.** Give stages verb-ish labels that read as a sequence
  ("Bring the data in" → "Fold it in" → "Single source of truth"), and the columns
  become the story. Cards with no `stage` each get their own column. Keep them
  short — the stage prints inside every card in its column.
- **`status` earns its keep** when part of the system is not built yet: `open` on a
  card is a visible admission, which is exactly what you want the user to argue with.
- **`key: true` on at most one card** — normally the decision you need from the user.
- **Put your real question in a `choice`.** A choice is how the user answers *inside*
  the diagram; `read_feedback.py` reports the pick and lists any choice they skipped
  under "STILL OPEN". A `quiz` is for checking the explanation landed, not for asking.
- **`pitfall` is for the thing that bites**, not a generic caveat. It is the highest-value
  block on the card and the one a reviewer is most likely to correct.
- **Backward edges are free.** A `from` later in the flow to an earlier card routes
  itself down and around as a dashed return lane — use it for retries, version checks,
  write-backs.

## Legacy boards

A `board.json` in the older node/edge format (`nodes: [{id, text, group}]`, plus
`notes` / `text` arrays) still loads: nodes become title-only cards, `group` becomes
`stage`, and the annotations become sticky notes below the diagram. Rewrite it as
`cards` to get bodies, stats, pitfalls and questions.
