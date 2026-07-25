#!/usr/bin/env python3
"""
Read a whiteboard-flow review back as a STEERING DIGEST.

The tldraw whiteboard had to *diff* shapes to guess what the reviewer meant.
Here the reviewer's intent is typed at the source — a verdict and a comment per
box — so this just reads `feedback.json` and renders it as an ordered directive
the agent can act on.

    python3 read_feedback.py --slug shell-review-app
    python3 read_feedback.py --slug shell-review-app --json
    python3 read_feedback.py --slug shell-review-app --md   # also writes feedback.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BOARDS = Path(os.environ.get("FLOW_BOARDS_DIR", ROOT / "boards")).expanduser()

ORDER = ["first", "change", "cut", "keep"]
HEAD = {
    "first": ("▲ DO FIRST", "reorder the plan around these"),
    "change": ("✎ CHANGE", "keep, but not as drawn"),
    "cut": ("✕ CUT", "drop from the plan"),
    "keep": ("✓ KEEP", "correct as drawn — no action"),
}
RULE = "─" * 72


def load(slug: str):
    d = BOARDS / slug
    bp, fp = d / "board.json", d / "feedback.json"
    if not bp.exists():
        avail = sorted(p.parent.name for p in BOARDS.glob("*/board.json"))
        sys.exit(f"no board at {bp}\navailable: {', '.join(avail) or '(none)'}")
    board = json.loads(bp.read_text())
    fb = json.loads(fp.read_text()) if fp.exists() else {}
    return board, fb, d


def collect(board, fb):
    nodes = {n["id"]: n for n in board.get("nodes", [])}
    marks = fb.get("marks") or []
    edges = {}
    for i, e in enumerate(board.get("edges", [])):
        edges[e.get("id") or f"e{i}"] = e

    nfb = fb.get("nodes") or {}
    efb = fb.get("edges") or {}

    # A handwritten note pinned to a box is a comment on that box — it just came
    # in through the pen instead of the panel. Fold it in so it shows up next to
    # the verdict rather than stranded in a "drawings" appendix.
    hand_notes = {}
    for m in marks:
        if m.get("type") == "text" and (m.get("text") or "").strip():
            for nid in m.get("anchors") or []:
                hand_notes.setdefault(nid, []).append(m["text"].strip())

    buckets = {k: [] for k in ORDER}
    commented_only = []
    for nid, spec in nodes.items():
        entry = nfb.get(nid) or {}
        verdict = entry.get("verdict")
        comment = (entry.get("comment") or "").strip()
        if verdict in buckets:
            buckets[verdict].append((spec, comment))
        elif comment or nid in hand_notes:
            commented_only.append((spec, comment))

    edge_notes = []
    for eid, spec in edges.items():
        entry = efb.get(eid) or {}
        verdict = entry.get("verdict")
        comment = (entry.get("comment") or "").strip()
        if verdict or comment:
            edge_notes.append((eid, spec, verdict, comment))

    reviewed = {
        nid
        for nid, e in nfb.items()
        if e and (e.get("verdict") or (e.get("comment") or "").strip())
    } | set(hand_notes)
    unreviewed = [n["id"] for n in board.get("nodes", []) if n["id"] not in reviewed]

    answers = []
    for i, q in enumerate(board.get("questions", [])):
        a = ((fb.get("answers") or {}).get(str(i)) or "").strip()
        if a:
            answers.append((q, a))

    return {
        "nodes": nodes,
        "buckets": buckets,
        "commented_only": commented_only,
        "edge_notes": edge_notes,
        "unreviewed": unreviewed,
        "answers": answers,
        "proposed_nodes": [p for p in fb.get("proposedNodes") or [] if (p.get("text") or "").strip()],
        "proposed_edges": fb.get("proposedEdges") or [],
        "general": (fb.get("general") or "").strip(),
        "marks": marks,
        "hand_notes": hand_notes,
        # so a hand-drawn arrow can be told apart from one that just re-traces the plan
        "existing_edges": {(e["from"], e["to"]) for e in board.get("edges", [])}
        | {(e["from"], e["to"]) for e in fb.get("proposedEdges") or []},
        "reviewed_count": len(reviewed),
        "total": len(nodes),
    }


def label(spec):
    return (spec.get("text") or spec.get("id") or "?").replace("\n", " ")


def meta_line(spec):
    bits = []
    if spec.get("group"):
        bits.append(spec["group"])
    if spec.get("status"):
        bits.append(spec["status"])
    if spec.get("file"):
        bits.append(spec["file"])
    return " · ".join(bits)


def namer(data):
    """id -> readable label, covering plan boxes and reviewer-proposed ones."""
    names = dict(data["nodes"])
    for p in data["proposed_nodes"]:
        names[p["id"]] = p
    return lambda i: label(names.get(i, {"text": i}))


def mark_sections(data):
    """Freehand markup, bucketed for reporting.

    Notes that landed on a box are reported *with that box* instead of here, so
    every signal appears exactly once. What's left is markup that has no natural
    home in the verdict list: floating notes, arrows, regions, raw strokes.
    """
    floating, arrows, regions, strokes = [], [], [], []
    for m in data["marks"]:
        t = m.get("type")
        if t == "text":
            if (m.get("text") or "").strip() and not (m.get("anchors") or []):
                floating.append(m)
        elif t == "arrow":
            arrows.append(m)
        elif t == "region":
            regions.append(m)
        elif t == "ink":
            strokes.append(m)
    return floating, arrows, regions, strokes


def wrap(text, indent, width=88):
    out, line = [], ""
    for word in text.split():
        if len(line) + len(word) + 1 > width - len(indent):
            out.append(indent + line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        out.append(indent + line)
    return out


def render_text(board, fb, data) -> str:
    L = []
    slug = board.get("slug") or ""
    nm = namer(data)
    floating, arrows, regions, strokes = mark_sections(data)
    mark_signals = len(floating) + len(arrows) + len(regions) + len(strokes) + sum(
        len(v) for v in data["hand_notes"].values()
    )

    def hand(spec):
        """The pen's notes for this box, indented under its entry."""
        return [
            line
            for note in data["hand_notes"].get(spec.get("id"), [])
            for line in wrap(f'✎ handwritten: "{note}"', "      ")
        ]

    L.append("═" * 72)
    L.append(f"STEERING DIGEST — {board.get('title', slug)}")
    who = fb.get("reviewer") or "(unnamed reviewer)"
    when = (fb.get("updated") or "never")[:19].replace("T", " ")
    sig = (
        sum(len(v) for v in data["buckets"].values())
        + len(data["commented_only"])
        + len(data["edge_notes"])
        + len(data["proposed_nodes"])
        + len(data["proposed_edges"])
        + len(data["answers"])
        + (1 if data["general"] else 0)
        + mark_signals
    )
    L.append(
        f"{who} · saved {when} · {sig} signal(s) · "
        f"{data['reviewed_count']}/{data['total']} boxes reviewed"
    )
    L.append("═" * 72)

    if sig == 0:
        L.append("")
        L.append("No feedback recorded yet — the reviewer hasn't marked anything up.")
        return "\n".join(L)

    for key in ORDER:
        items = data["buckets"][key]
        if not items:
            continue
        title, gloss = HEAD[key]
        L.append("")
        L.append(f"{title} ({len(items)}) — {gloss}")
        L.append(RULE)
        if key == "keep":
            # anything with a comment gets its own entry; the rest collapse to one line
            bare = [s for s, c in items if not c and not hand(s)]
            if bare:
                L.append("  " + ", ".join(label(s) for s in bare))
            for spec, comment in items:
                if comment or hand(spec):
                    L.append(f"  · {label(spec)}")
                    if comment:
                        L += wrap(f"▸ {comment}", "      ")
                    L += hand(spec)
            continue
        for spec, comment in items:
            L.append(f"  · {label(spec)}   [{spec.get('id')}]")
            m = meta_line(spec)
            if m:
                L.append(f"      {m}")
            if comment:
                L += wrap(f"▸ {comment}", "      ")
            elif not hand(spec):
                L.append("      ▸ (no comment — verdict only)")
            L += hand(spec)

    if data["commented_only"]:
        L.append("")
        L.append(f"💬 COMMENTED, NO VERDICT ({len(data['commented_only'])})")
        L.append(RULE)
        for spec, comment in data["commented_only"]:
            L.append(f"  · {label(spec)}   [{spec.get('id')}]")
            if comment:
                L += wrap(f"▸ {comment}", "      ")
            L += hand(spec)

    if data["proposed_nodes"]:
        L.append("")
        L.append(f"+ NEW WORK PROPOSED BY REVIEWER ({len(data['proposed_nodes'])})")
        L.append(RULE)
        for p in data["proposed_nodes"]:
            L.append(f"  · {p['text']}")
            if (p.get("comment") or "").strip():
                L += wrap(f"▸ {p['comment'].strip()}", "      ")

    if data["edge_notes"] or data["proposed_edges"]:
        L.append("")
        L.append(
            f"⇢ CONNECTIONS ({len(data['edge_notes']) + len(data['proposed_edges'])})"
        )
        L.append(RULE)
        for eid, spec, verdict, comment in data["edge_notes"]:
            tag = f"[{verdict}] " if verdict else ""
            L.append(f"  · {tag}{nm(spec['from'])} → {nm(spec['to'])}")
            if comment:
                L += wrap(f"▸ {comment}", "      ")
        for e in data["proposed_edges"]:
            L.append(f"  · [NEW] {nm(e['from'])} → {nm(e['to'])}")
            if (e.get("comment") or "").strip():
                L += wrap(f"▸ {e['comment'].strip()}", "      ")

    if floating or arrows or regions or strokes:
        L.append("")
        L.append(f"✎ FREEHAND MARKUP ({len(floating) + len(arrows) + len(regions) + len(strokes)})")
        L.append(RULE)
        if data["hand_notes"]:
            L.append("  (handwritten notes that landed on a box are listed with that box above)")

        for m in floating:
            L += wrap(f'· note, unattached: "{m["text"].strip()}"', "  ")

        for m in arrows:
            a, b = m.get("hitFrom"), m.get("hitTo")
            if a and b:
                L.append(f"  · arrow drawn: {nm(a)}  →  {nm(b)}")
                if (a, b) in data["existing_edges"]:
                    L.append("      ▸ the plan already has this edge — read it as emphasis on that dependency")
                elif (b, a) in data["existing_edges"]:
                    L.append("      ▸ the plan has this edge the OTHER way round — the reviewer may be reversing it")
                else:
                    L.append("      ▸ a link the plan doesn't have — decide whether it belongs")
            elif a or b:
                known = nm(a or b)
                L.append(f"  · arrow {'from' if a else 'into'} {known}, other end in open space")
            else:
                L.append("  · arrow in open space (nothing at either end)")

        for m in regions:
            ring = [nm(i) for i in (m.get("anchors") or [])]
            L.append(f"  · region ringed: {', '.join(ring) if ring else '(empty area)'}")
            if len(ring) > 1:
                L.append("      ▸ treat these as one unit — the reviewer grouped them deliberately")

        # strokes carry no words, so the useful signal is purely "over what"
        by_target = {}
        for m in strokes:
            key = (tuple(m.get("anchors") or []), bool(m.get("highlight")))
            by_target[key] = by_target.get(key, 0) + 1
        for (anchors, hl), n in sorted(by_target.items(), key=lambda kv: -kv[1]):
            pen = "highlighter" if hl else "pen"
            where = ", ".join(nm(i) for i in anchors) if anchors else "open space"
            L.append(f"  · {n} {pen} mark{'' if n == 1 else 's'} over {where}")

    if data["answers"]:
        L.append("")
        L.append(f"? OPEN QUESTIONS ANSWERED ({len(data['answers'])})")
        L.append(RULE)
        for q, a in data["answers"]:
            L += wrap(f"Q: {q}", "  ")
            L += wrap(f"A: {a}", "     ")

    if data["general"]:
        L.append("")
        L.append("▸ GENERAL DIRECTION")
        L.append(RULE)
        L += wrap(data["general"], "  ")

    if data["unreviewed"]:
        L.append("")
        L.append(f"○ UNREVIEWED ({len(data['unreviewed'])}) — no opinion given, leave as planned")
        L.append("  " + ", ".join(data["unreviewed"]))

    # ---- the directive ---------------------------------------------------
    L.append("")
    L.append("═" * 72)
    L.append("ACTION CONTRACT — apply in this order")
    L.append("═" * 72)
    step = 1
    if data["buckets"]["cut"]:
        L.append(f"  {step}. Remove from the plan: " + ", ".join(label(s) for s, _ in data["buckets"]["cut"]))
        step += 1
    if data["buckets"]["first"]:
        L.append(f"  {step}. Do next, ahead of everything else: " + ", ".join(label(s) for s, _ in data["buckets"]["first"]))
        step += 1
    if data["proposed_nodes"]:
        L.append(f"  {step}. Add to the plan: " + ", ".join(p["text"] for p in data["proposed_nodes"]))
        step += 1
    if data["buckets"]["change"]:
        L.append(f"  {step}. Rework per the comment: " + ", ".join(label(s) for s, _ in data["buckets"]["change"]))
        step += 1
    linked = [
        m
        for m in arrows
        if m.get("hitFrom")
        and m.get("hitTo")
        and (m["hitFrom"], m["hitTo"]) not in data["existing_edges"]
    ]
    if linked:
        L.append(
            f"  {step}. Wire up the hand-drawn links: "
            + ", ".join(f"{nm(m['hitFrom'])} → {nm(m['hitTo'])}" for m in linked)
        )
        step += 1
    if data["answers"]:
        L.append(f"  {step}. Treat the answered questions above as decided — stop asking.")
        step += 1
    if data["general"]:
        L.append(f"  {step}. Apply the general direction across the whole plan.")
        step += 1
    if regions or strokes or floating:
        L.append(f"  {step}. Read the remaining freehand markup as emphasis on the boxes it names.")
        step += 1
    if step == 1:
        L.append("  (nothing actionable — comments only)")
    L.append("")
    L.append("Then update board.json to match and re-serve for the next round.")
    return "\n".join(L)


def render_md(board, fb, data) -> str:
    nm = namer(data)
    floating, arrows, regions, strokes = mark_sections(data)
    L = [f"# Review feedback — {board.get('title')}", ""]
    L.append(f"*{fb.get('reviewer') or 'reviewer'} · {(fb.get('updated') or '')[:19].replace('T',' ')}*")
    for key in ORDER:
        items = data["buckets"][key]
        if not items:
            continue
        L += ["", f"## {HEAD[key][0]}"]
        for spec, comment in items:
            L.append(f"- **{label(spec)}** (`{spec.get('id')}`)" + (f" — {comment}" if comment else ""))
            for note in data["hand_notes"].get(spec.get("id"), []):
                L.append(f"  - ✎ handwritten: *{note}*")
    if data["proposed_nodes"]:
        L += ["", "## Proposed by reviewer"]
        for p in data["proposed_nodes"]:
            L.append(f"- **{p['text']}**" + (f" — {p.get('comment','').strip()}" if p.get("comment") else ""))
    if data["answers"]:
        L += ["", "## Questions answered"]
        for q, a in data["answers"]:
            L.append(f"- **{q}**  \n  {a}")
    if floating or arrows or regions or strokes:
        L += ["", "## Freehand markup"]
        for m in floating:
            L.append(f"- note: *{m['text'].strip()}*")
        for m in arrows:
            a, b = m.get("hitFrom"), m.get("hitTo")
            L.append(f"- arrow: {nm(a) if a else '?'} → {nm(b) if b else '?'}")
        for m in regions:
            L.append("- region: " + (", ".join(nm(i) for i in (m.get("anchors") or [])) or "(empty area)"))
        for m in strokes:
            where = ", ".join(nm(i) for i in (m.get("anchors") or [])) or "open space"
            L.append(f"- {'highlighter' if m.get('highlight') else 'pen'} over {where}")
    if data["general"]:
        L += ["", "## General direction", "", data["general"]]
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--json", action="store_true", help="machine-readable dump")
    ap.add_argument("--md", action="store_true", help="also write <board>/feedback.md")
    args = ap.parse_args()

    board, fb, d = load(args.slug)
    board["slug"] = args.slug
    data = collect(board, fb)

    if args.json:
        print(json.dumps({"board": board.get("title"), "feedback": fb, "digest": {
            k: [{"id": s.get("id"), "text": label(s), "comment": c} for s, c in v]
            for k, v in data["buckets"].items()
        }}, indent=2))
        return

    print(render_text(board, fb, data))
    if args.md:
        p = d / "feedback.md"
        p.write_text(render_md(board, fb, data))
        print(f"\nwrote {p}")


if __name__ == "__main__":
    main()
