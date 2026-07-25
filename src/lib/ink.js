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

const rp = ([x, y]) => [r1(x), r1(y)];

/** Chord-length parameterisation — spacing points by distance, not by index, so
 *  a slow patch of the drag doesn't drag the fitted curve towards itself. */
function arcParams(path) {
  const d = [0];
  for (let i = 1; i < path.length; i++) {
    d.push(d[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  const total = d[d.length - 1] || 1;
  return d.map((v) => v / total);
}

/** A least-squares fit can overshoot wildly on a jittery drag; keep the control
 *  points within sight of the arrow they belong to. */
function clampCtrl(c, anchor, len) {
  const max = 2.5 * len;
  const dx = c[0] - anchor[0];
  const dy = c[1] - anchor[1];
  const d = Math.hypot(dx, dy);
  if (d <= max || !d) return c;
  const k = max / d;
  return [anchor[0] + dx * k, anchor[1] + dy * k];
}

/**
 * Fit a cubic Bézier to the path the pointer actually travelled.
 *
 * An arrow drawn at a whiteboard is rarely straight — you swing it around the
 * boxes in between. Rather than inventing a curve, this reads back the one that
 * was drawn: least squares for the two control points with **both endpoints
 * pinned**, so the arrow keeps the exact start and end that resolve it to
 * "X → Y" while the middle follows the gesture.
 *
 * `c1`/`c2` come back null unless the drag genuinely bowed, which is what keeps
 * a deliberate straight arrow straight — and every arrow drawn before curves
 * existed renders exactly as it did.
 */
export function fitArrow(path, { straight = false, minBow = 6 } = {}) {
  const from = rp(path[0]);
  const to = rp(path[path.length - 1]);
  const flat = { from, to, c1: null, c2: null };
  if (straight || path.length < 4) return flat;

  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (len < 1) return flat;

  // How far the gesture strayed from the straight line between its own ends.
  // The threshold scales with length: a long arrow has to bow more to count,
  // otherwise an unsteady hand curves every arrow slightly.
  let bow = 0;
  for (const p of path) bow = Math.max(bow, segDist(p, from, to));
  if (bow < Math.max(minBow, len * 0.04)) return flat;

  // Alternate between solving for the control points and re-deciding which `t`
  // each sample sits at. Distance-along-the-path is only a guess at that, and on
  // its own it fits a smooth arch visibly worse than eyeballing one would. Each
  // Newton pass roughly halves the error; the whole loop is a few thousand
  // multiplies on ~40 points, so it runs on every pointermove without being felt.
  let ts = arcParams(path);
  let ctrl = solveCtrl(path, ts, from, to);
  if (!ctrl) return flat;
  for (let pass = 0; pass < 8; pass++) {
    ts = reparam(path, ts, from, to, ctrl);
    const next = solveCtrl(path, ts, from, to);
    if (!next) break;
    const step = Math.max(
      Math.hypot(next[0][0] - ctrl[0][0], next[0][1] - ctrl[0][1]),
      Math.hypot(next[1][0] - ctrl[1][0], next[1][1] - ctrl[1][1]),
    );
    ctrl = next;
    if (step < 0.05) break; // converged — further passes just burn cycles
  }

  return { from, to, c1: rp(clampCtrl(ctrl[0], from, len)), c2: rp(clampCtrl(ctrl[1], to, len)) };
}

/** Least squares for the two control points, endpoints held fixed:
 *  B(t) = (1-t)³A + 3(1-t)²t·C1 + 3(1-t)t²·C2 + t³B */
function solveCtrl(path, ts, from, to) {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  const rhs1 = [0, 0];
  const rhs2 = [0, 0];
  for (let i = 0; i < path.length; i++) {
    const t = ts[i];
    const u = 1 - t;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    for (let k = 0; k < 2; k++) {
      const res = path[i][k] - (u * u * u * from[k] + t * t * t * to[k]);
      rhs1[k] += b1 * res;
      rhs2[k] += b2 * res;
    }
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return null;
  const c1 = [];
  const c2 = [];
  for (let k = 0; k < 2; k++) {
    c1[k] = (rhs1[k] * a22 - rhs2[k] * a12) / det;
    c2[k] = (rhs2[k] * a11 - rhs1[k] * a12) / det;
  }
  return [c1, c2];
}

/** One Newton–Raphson step towards each sample's closest point on the curve. */
function reparam(path, ts, from, to, [c1, c2]) {
  return ts.map((t, i) => {
    if (i === 0) return 0;
    if (i === path.length - 1) return 1;
    const u = 1 - t;
    const d = [0, 0];
    const d1 = [0, 0];
    const d2 = [0, 0];
    for (let k = 0; k < 2; k++) {
      d[k] = u * u * u * from[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * to[k] - path[i][k];
      d1[k] = 3 * u * u * (c1[k] - from[k]) + 6 * u * t * (c2[k] - c1[k]) + 3 * t * t * (to[k] - c2[k]);
      d2[k] = 6 * u * (c2[k] - 2 * c1[k] + from[k]) + 6 * t * (to[k] - 2 * c2[k] + c1[k]);
    }
    const num = d[0] * d1[0] + d[1] * d1[1];
    const den = d1[0] * d1[0] + d1[1] * d1[1] + d[0] * d2[0] + d[1] * d2[1];
    if (Math.abs(den) < 1e-9) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}

/** Symmetric arc, for scripting a curve instead of dragging one. `bow` is a
 *  fraction of the arrow's own length; sign picks the side it bulges towards. */
export function bowCtrl(from, to, bow = 0.25) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return [
    rp([from[0] + dx / 3 - dy * bow, from[1] + dy / 3 + dx * bow]),
    rp([from[0] + (dx * 2) / 3 - dy * bow, from[1] + (dy * 2) / 3 + dx * bow]),
  ];
}

/** An arrow flattened to a polyline — for bounds and hit tests, which both need
 *  to follow the curve rather than the chord under it. */
export function curvePoints(m, n = 18) {
  if (!m.c1 || !m.c2) return [m.from, m.to];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push([
      w0 * m.from[0] + w1 * m.c1[0] + w2 * m.c2[0] + w3 * m.to[0],
      w0 * m.from[1] + w1 * m.c1[1] + w2 * m.c2[1] + w3 * m.to[1],
    ]);
  }
  return out;
}

export function arrowPath(m) {
  const { from, to, c1, c2 } = m;
  if (!c1 || !c2) return `M ${r1(from[0])} ${r1(from[1])} L ${r1(to[0])} ${r1(to[1])}`;
  return `M ${r1(from[0])} ${r1(from[1])} C ${r1(c1[0])} ${r1(c1[1])}, ${r1(c2[0])} ${r1(c2[1])}, ${r1(to[0])} ${r1(to[1])}`;
}

/** What the arrowhead should point away from: the curve's tangent at the tip,
 *  not the straight line back to the start — otherwise a bowed arrow lands with
 *  its head visibly skewed off the stroke it terminates. */
export function arrowTail(m) {
  for (const c of [m.c2, m.c1, m.from]) {
    if (c && Math.hypot(m.to[0] - c[0], m.to[1] - c[1]) > 0.5) return c;
  }
  return m.from;
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
  if (m.type === 'arrow') {
    // A curve leaves the box its endpoints describe, and this box is what sizes
    // the SVG and picks the anchors — so measure the flattened curve, not the chord.
    const pts = curvePoints(m);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
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
  if (m.type === 'arrow') {
    const shift = (p) => [r1(p[0] + dx), r1(p[1] + dy)];
    const moved = { from: shift(m.from), to: shift(m.to) };
    // control points ride along, or the curve inverts as the arrow re-seats
    if (m.c1 && m.c2) Object.assign(moved, { c1: shift(m.c1), c2: shift(m.c2) });
    return moved;
  }
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
  if (m.type === 'arrow') {
    const pts = curvePoints(m, 24);
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= tol + 3) return true;
    return false;
  }
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
