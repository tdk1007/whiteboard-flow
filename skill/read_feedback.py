#!/usr/bin/env python3
"""
Read a marked-up whiteboard back as feedback.

The board auto-saves a typed snapshot (`snapshot.json`) as the user works. This
reads it off disk — no browser, no screenshot — and prints what the user did:
answered a choice, took a knowledge check, left a sticky note, drew on a card,
dragged a card, relabelled a title, or struck a card out.

Every free-floating mark or note is attributed to the nearest card so the
feedback reads as "note on <card>" rather than raw coordinates.

Usage:
  python3 read_feedback.py --slug <slug>          # human-readable digest
  python3 read_feedback.py --slug <slug> --json   # machine-readable
  python3 read_feedback.py --slug <slug> --md     # also write feedback.md
"""
import argparse, json, math, os, sys

ROOT = os.path.expanduser(os.environ.get("WHITEBOARDS_DIR", "~/whiteboards"))
MOVE_THRESHOLD = 8   # px; ignore sub-pixel jitter
CW, CH = 372, 320    # fallbacks when a card has no measured box


# ---------------------------------------------------------------- loading ----
def load(slug):
    d = os.path.join(ROOT, slug)
    snap_p = os.path.join(d, "snapshot.json")
    board_p = os.path.join(d, "board.json")
    if not os.path.exists(board_p):
        sys.exit("No board.json for '%s'.\n(%s)" % (slug, board_p))
    board = json.load(open(board_p))
    if not os.path.exists(snap_p):
        sys.exit("No snapshot.json for '%s' yet — open the board and make an edit first.\n(%s)"
                 % (slug, snap_p))
    snap = json.load(open(snap_p))
    if "document" in snap and "v" not in snap:
        sys.exit("'%s' has a legacy tldraw snapshot. Re-serve with --reseed to rebuild it "
                 "on the current board renderer:\n  python3 %s --slug %s --reseed --open"
                 % (slug, os.path.join(os.path.dirname(os.path.abspath(__file__)), "serve.py"), slug))
    return snap, board


def cards_of(board):
    """The card list, tolerating the older node/edge board format."""
    cards = board.get("cards")
    if isinstance(cards, list) and cards:
        out = []
        for i, c in enumerate(cards):
            if not isinstance(c, dict) or c.get("id") is None:
                continue
            c = dict(c)
            c["id"] = str(c["id"])
            c.setdefault("n", i + 1)
            c["title"] = str(c.get("title") or c["id"])
            out.append(c)
        return out
    return [{"id": str(n.get("id")), "n": i + 1,
             "title": str(n.get("text") or n.get("title") or n.get("id") or "").replace("\n", " ")}
            for i, n in enumerate(board.get("nodes") or []) if n.get("id") is not None]


# --------------------------------------------------------------- geometry ----
def boxes(snap, cards):
    """Card id -> (x, y, w, h) as currently placed (drag overrides baseline)."""
    lay = snap.get("layout") or {}
    pos = snap.get("pos") or {}
    out = {}
    for c in cards:
        cid = c["id"]
        base = lay.get(cid) or {}
        p = pos.get(cid) or base
        out[cid] = (float(p.get("x", 0)), float(p.get("y", 0)),
                    float(base.get("w", CW) or CW), float(base.get("h", CH) or CH))
    return out


def nearest(box, titles, x, y):
    """Title of the card whose rectangle is closest to (x, y)."""
    best, bd = None, float("inf")
    for cid, (bx, by, bw, bh) in box.items():
        dx = max(bx - x, 0.0, x - (bx + bw))
        dy = max(by - y, 0.0, y - (by + bh))
        d = math.hypot(dx, dy)
        if d < bd:
            bd, best = d, cid
    return titles.get(best, best) if best else "the canvas"


# ----------------------------------------------------------------- digest ----
def analyse(snap, board):
    cards = cards_of(board)
    by_id = {c["id"]: c for c in cards}
    box = boxes(snap, cards)
    relabels = snap.get("titles") or {}
    # attribute marks/notes using whatever the card is called NOW
    titles = {c["id"]: relabels.get(c["id"], c["title"]) for c in cards}

    r = {"answered": [], "unanswered": [], "quiz": [], "notes": [], "added": [],
         "marks": [], "moved": [], "relabeled": [], "struck": []}

    for c in cards:
        cid = c["id"]
        ch = c.get("choice") or {}
        opts = ch.get("options") or []
        if opts:
            pick = (snap.get("choices") or {}).get(cid)
            if isinstance(pick, int) and 0 <= pick < len(opts):
                o = opts[pick]
                r["answered"].append({"card": titles[cid], "q": ch.get("q", ""),
                                      "choice": (o.get("label") if isinstance(o, dict) else str(o)),
                                      "why": (o.get("r", "") if isinstance(o, dict) else "")})
            else:
                r["unanswered"].append({"card": titles[cid], "q": ch.get("q", "")})

        qz = c.get("quiz") or {}
        qopts = qz.get("options") or []
        if qopts:
            pick = (snap.get("quiz") or {}).get(cid)
            if isinstance(pick, int) and 0 <= pick < len(qopts):
                r["quiz"].append({"card": titles[cid], "q": qz.get("q", ""),
                                  "answer": str(qopts[pick]),
                                  "correct": pick == qz.get("correct")})

        if cid in relabels and relabels[cid] != c["title"]:
            r["relabeled"].append({"card": cid, "was": c["title"], "now": relabels[cid]})

        lay = (snap.get("layout") or {}).get(cid)
        p = (snap.get("pos") or {}).get(cid)
        if lay and p:
            dx, dy = float(p.get("x", 0)) - float(lay.get("x", 0)), float(p.get("y", 0)) - float(lay.get("y", 0))
            if abs(dx) > MOVE_THRESHOLD or abs(dy) > MOVE_THRESHOLD:
                r["moved"].append({"card": titles[cid], "dx": round(dx), "dy": round(dy)})

    for cid in snap.get("struck") or []:
        if cid in by_id:
            r["struck"].append({"card": titles.get(cid, cid)})

    for n in snap.get("notes") or []:
        txt = (n.get("text") or "").strip()
        if txt:
            r["notes"].append({"near": nearest(box, titles, float(n.get("x", 0)), float(n.get("y", 0))),
                               "text": txt})

    # boxes the user drew with the box tool — a card they think is missing
    for b in snap.get("boxes") or []:
        r["added"].append({"near": nearest(box, titles, float(b.get("x", 0)), float(b.get("y", 0))),
                           "text": (b.get("text") or "").strip()})

    for m in snap.get("marks") or []:
        pts = m.get("pts") or []
        if not pts:
            continue
        r["marks"].append({"kind": "highlighter" if m.get("type") == "marker" else "pen",
                           "color": m.get("color", ""),
                           "over": nearest(box, titles, float(pts[0][0]), float(pts[0][1]))})

    mode = snap.get("mode") or {}
    r["read_mode"] = "plain english" if mode.get("all") else "standard"
    r["per_card_plain_english"] = sorted(k for k, v in (mode.get("per") or {}).items() if v)
    return r


def has_feedback(r):
    return any(r[k] for k in ("answered", "quiz", "notes", "added", "marks",
                              "moved", "relabeled", "struck"))


def lines(slug, r, bullet="  • "):
    L = []
    if r["answered"]:
        L.append("")
        L.append("ANSWERED (%d):" % len(r["answered"]))
        for a in r["answered"]:
            L.append(bullet + '%s → "%s"' % (a["card"], a["choice"]))
            if a["q"]:
                L.append("      q: " + a["q"])
    if r["quiz"]:
        L.append("")
        L.append("KNOWLEDGE CHECK (%d):" % len(r["quiz"]))
        for q in r["quiz"]:
            L.append(bullet + '%s → "%s" (%s)' % (q["card"], q["answer"], "correct" if q["correct"] else "WRONG"))
    if r["notes"]:
        L.append("")
        L.append("NOTES (%d):" % len(r["notes"]))
        for n in r["notes"]:
            L.append(bullet + "on %s: %s" % (n["near"], n["text"]))
    if r["added"]:
        L.append("")
        L.append("ADDED BOXES (%d) — cards the user says are missing:" % len(r["added"]))
        for b in r["added"]:
            L.append(bullet + "near %s: %s" % (b["near"], b["text"] or "(left empty)"))
    if r["marks"]:
        L.append("")
        L.append("DREW ON (%d):" % len(r["marks"]))
        for m in r["marks"]:
            L.append(bullet + "%s over %s" % (m["kind"], m["over"]))
    if r["moved"]:
        L.append("")
        L.append("MOVED (%d):" % len(r["moved"]))
        for m in r["moved"]:
            L.append(bullet + "%s by (%+d, %+d)" % (m["card"], m["dx"], m["dy"]))
    if r["relabeled"]:
        L.append("")
        L.append("RELABELED (%d):" % len(r["relabeled"]))
        for e in r["relabeled"]:
            L.append(bullet + '"%s" → "%s"' % (e["was"], e["now"]))
    if r["struck"]:
        L.append("")
        L.append("STRUCK OUT (%d):" % len(r["struck"]))
        for s in r["struck"]:
            L.append(bullet + s["card"])
    if r["unanswered"]:
        L.append("")
        L.append("STILL OPEN (%d question%s):" % (len(r["unanswered"]), "" if len(r["unanswered"]) == 1 else "s"))
        for u in r["unanswered"]:
            L.append(bullet + "%s — %s" % (u["card"], u["q"] or "(unanswered)"))
    return L


def render_md(slug, r):
    L = ["# Whiteboard feedback — %s" % slug, ""]
    if not has_feedback(r):
        L.append("_No markup yet — the board is as the agent drew it._")
        return "\n".join(L) + "\n"
    L.append("Read in **%s** mode." % r["read_mode"])
    for ln in lines(slug, r, bullet="- "):
        if ln.endswith(":") and ln.split(" ")[0].isupper():
            L.append("## " + ln.rstrip(":").title())
        elif ln.startswith("      q: "):
            L.append("  - _%s_" % ln.strip()[3:])
        else:
            L.append(ln)
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--md", action="store_true",
                    help="also write feedback.md to the board dir and print its path")
    args = ap.parse_args()

    snap, board = load(args.slug)
    r = analyse(snap, board)

    if args.json:
        print(json.dumps(r, indent=2))
        return

    if args.md:
        md = render_md(args.slug, r)
        out = os.path.join(ROOT, args.slug, "feedback.md")
        with open(out, "w") as f:
            f.write(md)
        print(md)
        print(out)
        return

    print("=== Whiteboard feedback: %s ===" % args.slug)
    if not has_feedback(r):
        print("No markup yet — the board is as you drew it.")
        if r["unanswered"]:
            print("\n".join(lines(args.slug, r)))
        return
    print("read in %s mode" % r["read_mode"])
    print("\n".join(lines(args.slug, r)))


if __name__ == "__main__":
    main()
