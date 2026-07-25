/**
 * Freehand geometry — pen strokes, regions, arrows, and the maths that ties a
 * freeform mark back to the plan boxes it's *about*.
 *
 * That last part is the whole reason freehand drawing earns its place here. A
 * scribble is only useful to an agent if we can say what it was drawn over, so
 * every mark records `anchors` (the plan nodes it touches) at commit time, while
 * the layout is still on screen and we know where everything is.
 */

const r1 = (n) => Math.round(n * 10) / 10;

/** Ramer–Douglas–Peucker. A pointermove stream is ~500 points for one stroke;
 *  this gets it to ~40 with no visible change, which keeps feedback.json small. */
export function simplify(points, eps = 1.2) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let idx = -1;
    let max = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx > -1 && max > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Quadratic through the midpoints — the standard trick for a pen that doesn't
 *  look like a polyline. Same softening idea as the ELK route renderer. */
export function inkPath(points) {
  if (!points || !points.length) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${r1(x)} ${r1(y)} l 0.01 0`;
  }
  let d = `M ${r1(points[0][0])} ${r1(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q ${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${r1(last[0])} ${r1(last[1])}`;
}

/** Arrowhead as a polygon, so it inherits the stroke colour without <marker> defs. */
export function arrowHead(from, to, size = 11) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const w = size * 0.52;
  return [
    [x2, y2],
    [x2 - size * Math.cos(a - 0.001) - w * Math.cos(a - Math.PI / 2), y2 - size * Math.sin(a) - w * Math.sin(a - Math.PI / 2)],
    [x2 - size * Math.cos(a) - w * Math.cos(a + Math.PI / 2), y2 - size * Math.sin(a) - w * Math.sin(a + Math.PI / 2)],
  ]
    .map(([x, y]) => `${r1(x)},${r1(y)}`)
    .join(' ');
}

export function normRect(a, b) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(a[0] - b[0]),
    h: Math.abs(a[1] - b[1]),
  };
}

/** Bounding box of any mark type, in flow coordinates. */
export function markBounds(m) {
  if (m.type === 'ink') {
    const xs = m.points.map((p) => p[0]);
    const ys = m.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (m.type === 'arrow') return normRect(m.from, m.to);
  if (m.type === 'region') return { x: m.x, y: m.y, w: m.w, h: m.h };
  // Text anchors from where the caret went, not from the width the note grew to.
  // Assuming a 140px box biased every note rightwards and let it claim a box the
  // reviewer wasn't pointing at.
  return { x: m.x, y: m.y, w: 10, h: 18 };
}

/** Move a mark in flow space — used to carry markup along when ELK re-lays the
 *  board out underneath it, so a circle drawn around a box stays around it. */
export function translateMark(m, dx, dy) {
  if (m.type === 'ink') return { points: m.points.map(([x, y]) => [r1(x + dx), r1(y + dy)]) };
  if (m.type === 'arrow') return { from: [r1(m.from[0] + dx), r1(m.from[1] + dy)], to: [r1(m.to[0] + dx), r1(m.to[1] + dy)] };
  return { x: r1(m.x + dx), y: r1(m.y + dy) };
}

function rectsOverlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function distToRect(p, b) {
  const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w));
  const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Which plan boxes is this mark about?
 *
 * `boxes` is [{id, x, y, w, h}] in flow space. Prefer real overlap (biggest
 * first); if a mark floats in empty space, fall back to the nearest box within
 * `near` px so a note beside a box still attaches to it.
 */
export function anchorsFor(bounds, boxes, { near = 130, max = 4 } = {}) {
  const hits = boxes
    .map((b) => ({ id: b.id, area: rectsOverlap(bounds, b) }))
    .filter((h) => h.area > 0)
    .sort((a, b) => b.area - a.area);
  if (hits.length) return hits.slice(0, max).map((h) => h.id);

  const c = [bounds.x + bounds.w / 2, bounds.y + bounds.h / 2];
  const closest = boxes
    .map((b) => ({ id: b.id, d: distToRect(c, b) }))
    .filter((h) => h.d <= near)
    .sort((a, b) => a.d - b.d);
  return closest.slice(0, 1).map((h) => h.id);
}

/** The box under a point (innermost wins), for resolving arrow endpoints. */
export function boxAt(point, boxes, slack = 0) {
  let best = null;
  for (const b of boxes) {
    if (
      point[0] >= b.x - slack &&
      point[0] <= b.x + b.w + slack &&
      point[1] >= b.y - slack &&
      point[1] <= b.y + b.h + slack
    ) {
      if (!best || b.w * b.h < best.w * best.h) best = b;
    }
  }
  return best?.id || null;
}

/** Eraser hit test: is `p` within `tol` of the mark's geometry? */
export function markHit(m, p, tol = 10) {
  if (m.type === 'ink') return m.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) <= tol + (m.width || 3));
  if (m.type === 'arrow') return segDist(p, m.from, m.to) <= tol + 3;
  if (m.type === 'region') {
    const b = markBounds(m);
    const outside = distToRect(p, b);
    if (outside > tol) return false;
    // hollow: only the border erases, so a region around boxes stays clickable
    const inside = Math.min(p[0] - b.x, b.x + b.w - p[0], p[1] - b.y, b.y + b.h - p[1]);
    return inside <= tol;
  }
  return distToRect(p, markBounds(m)) <= tol;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const PEN_COLORS = [
  { key: 'magenta', hex: '#c77dff', label: 'Reviewer' },
  { key: 'amber', hex: '#ffb648', label: 'Attention' },
  { key: 'red', hex: '#ff6b7d', label: 'Wrong' },
  { key: 'green', hex: '#47c98a', label: 'Good' },
  { key: 'blue', hex: '#5aa2ff', label: 'Note' },
  { key: 'chalk', hex: '#e6ebf2', label: 'Plain' },
];
