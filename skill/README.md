# skill/ — the shipped `/whiteboard`, vanilla JS

This directory is the **other** implementation in this repo. The root is the Svelte
Flow spike (see `../README.md`); this is the version that actually ships as a Claude
Code skill, installed at `~/.claude/skills/whiteboard/`.

|  | root (spike) | `skill/` (shipped) |
|---|---|---|
| Renderer | Svelte Flow (`@xyflow/svelte`) + ELK | hand-written vanilla JS, one file |
| Dependencies | npm install, Vite build | **none** — renders with the network off |
| Feedback | typed verdicts → `feedback.json` → ACTION CONTRACT | canvas markup diffed into a digest |
| Edge routing | ELK, obstacle-avoiding | own orthogonal router, multi-port |

They are kept side by side deliberately: the spike tests whether reviewer intent
should be *typed data* rather than shapes an agent interprets, and that question is
still open. Neither is a replacement for the other yet.

## Run it

```bash
python3 serve.py --slug <slug> --reseed --open      # writes ~/whiteboards/<slug>/
python3 read_feedback.py --slug <slug>              # read the markup back
```

Boards live in `~/whiteboards/<slug>/`, not in this repo.

## Routing notes

The router is orthogonal with rounded corners (smoothstep: no diagonal segments,
corners arced at 16px). Each card carries **multiple ports** — outgoing edges stack
down its right side, incoming down its left, each stack ordered by where the far end
sits vertically so lines don't cross on the way out. Every edge then gets its own
vertical channel. A trunked variant (edges collapsed onto shared channels) was tried
and rejected: it made individual connections impossible to trace.

The no-line-crosses-a-card guarantee covers the **generated** layout only. There is no
obstacle avoidance, so a card the user drags into someone else's edge will be crossed —
their position wins, by design.

Full authoring format: `references/spec.md`. Skill contract: `SKILL.md`.
