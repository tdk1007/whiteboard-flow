import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export const GROUP_PREFIX = 'grp::';
export const GROUP_HEADER = 34; // px reserved at the top of a group for its title

const BASE_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.spacing.nodeNodeBetweenLayers': '78',
  'elk.layered.spacing.edgeNodeBetweenLayers': '32',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
  'elk.spacing.nodeNode': '46',
  'elk.spacing.edgeNode': '30',
  'elk.spacing.edgeEdge': '18',
  'elk.spacing.edgeLabel': '10',
  'elk.spacing.labelNode': '12',
  'elk.padding': '[top=28,left=28,bottom=28,right=28]',
};

// Rough advance width for the edge-label font (11px system sans). Only needs to be
// close: ELK uses it to reserve a routing channel wide enough for the label.
const LABEL_CHAR_W = 6.1;
const LABEL_H = 16;

function groupId(name) {
  return GROUP_PREFIX + name;
}

/**
 * Run ELK over the logical board graph.
 *
 * @param board  the parsed board.json (nodes/edges, no coordinates)
 * @param sizes  Map<nodeId, {width,height}> — real measured DOM sizes when we have
 *               them (second pass), estimates on the first pass.
 * @param extra  { proposedNodes: [...], proposedEdges: [...] } from the reviewer,
 *               laid out together with the plan so nothing overlaps.
 */
export async function runLayout(board, sizes, extra = {}) {
  const direction = (board.direction || 'RIGHT').toUpperCase() === 'DOWN' ? 'DOWN' : 'RIGHT';

  const planNodes = board.nodes || [];
  const proposedNodes = extra.proposedNodes || [];
  const allNodes = [...planNodes, ...proposedNodes];

  const byId = new Map(allNodes.map((n) => [n.id, n]));

  // ---- containers -------------------------------------------------------
  const groups = new Map(); // name -> elk compound node
  const orderedGroupNames = [];
  for (const n of allNodes) {
    if (!n.group || groups.has(n.group)) continue;
    orderedGroupNames.push(n.group);
    groups.set(n.group, {
      id: groupId(n.group),
      layoutOptions: {
        'elk.padding': `[top=${GROUP_HEADER + 14},left=18,bottom=18,right=18]`,
        'elk.spacing.nodeNode': '34',
      },
      children: [],
    });
  }

  const root = {
    id: 'root',
    layoutOptions: { ...BASE_OPTIONS, 'elk.direction': direction },
    children: [],
    edges: [],
  };

  for (const n of allNodes) {
    const size = sizes.get(n.id) || { width: 190, height: 62 };
    const child = {
      id: n.id,
      width: Math.max(90, Math.round(size.width)),
      height: Math.max(40, Math.round(size.height)),
    };
    if (n.group) groups.get(n.group).children.push(child);
    else root.children.push(child);
  }
  for (const name of orderedGroupNames) root.children.push(groups.get(name));

  // ---- edges ------------------------------------------------------------
  const planEdges = (board.edges || []).map((e, i) => ({ ...e, _id: e.id || `e${i}`, _proposed: false }));
  const propEdges = (extra.proposedEdges || []).map((e) => ({ ...e, _id: e.id, _proposed: true }));
  const allEdges = [...planEdges, ...propEdges].filter((e) => byId.has(e.from) && byId.has(e.to));

  for (const e of allEdges) {
    const labels = e.text
      ? [{ text: e.text, width: Math.round(e.text.length * LABEL_CHAR_W) + 12, height: LABEL_H }]
      : [];
    root.edges.push({ id: e._id, sources: [e.from], targets: [e.to], labels });
  }

  const res = await elk.layout(root);

  // ---- absolute offsets -------------------------------------------------
  // ELK reports a child's x/y relative to its parent, and an edge's route points
  // relative to `edge.container`. Walk the tree once and record every container's
  // absolute origin so we can lift edge routes into page space.
  const offset = new Map();
  const abs = new Map();
  (function walk(n, ox, oy) {
    const x = ox + (n.x || 0);
    const y = oy + (n.y || 0);
    offset.set(n.id, { x, y });
    abs.set(n.id, { x, y, width: n.width, height: n.height });
    for (const c of n.children || []) walk(c, x, y);
  })(res, 0, 0);

  // ---- results ----------------------------------------------------------
  const nodePos = new Map(); // id -> position RELATIVE TO ITS PARENT (what Svelte Flow wants)
  for (const g of res.children || []) {
    if (g.id.startsWith(GROUP_PREFIX)) {
      for (const c of g.children || []) nodePos.set(c.id, { x: c.x || 0, y: c.y || 0 });
    } else {
      nodePos.set(g.id, { x: g.x || 0, y: g.y || 0 });
    }
  }

  const groupBoxes = orderedGroupNames.map((name) => {
    const g = abs.get(groupId(name));
    return { id: groupId(name), label: name, x: g.x, y: g.y, width: g.width, height: g.height };
  });

  const edgeById = new Map(allEdges.map((e) => [e._id, e]));
  const routes = [];
  for (const ee of res.edges || []) {
    const src = edgeById.get(ee.id);
    const sec = (ee.sections || [])[0];
    if (!src || !sec) continue;
    const off = offset.get(ee.container) || { x: 0, y: 0 };
    const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => ({
      x: p.x + off.x,
      y: p.y + off.y,
    }));
    const lbl = (ee.labels || [])[0];
    // A route that ends behind where it started is a feedback/return path — ELK
    // sends those on a long detour around the whole graph, which reads like a
    // stray frame unless it's drawn with less weight.
    const first = pts[0];
    const last = pts[pts.length - 1];
    const back = direction === 'DOWN' ? last.y < first.y - 12 : last.x < first.x - 12;

    routes.push({
      id: ee.id,
      from: src.from,
      to: src.to,
      points: pts,
      back,
      text: src.text || '',
      kind: src.kind || 'flow',
      proposed: src._proposed,
      comment: src.comment || '',
      labelX: lbl ? lbl.x + off.x + lbl.width / 2 : null,
      labelY: lbl ? lbl.y + off.y + lbl.height / 2 : null,
    });
  }

  const bounds = {
    width: res.width || 0,
    height: res.height || 0,
  };

  return { nodePos, groupBoxes, routes, bounds };
}

/** Turn an ELK polyline into an SVG path with softened corners. */
export function routeToPath(points, radius = 10) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.6) {
      d += ` L ${cur.x},${cur.y}`;
      continue;
    }
    const a = { x: cur.x + ((prev.x - cur.x) / inLen) * r, y: cur.y + ((prev.y - cur.y) / inLen) * r };
    const b = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L ${a.x},${a.y} Q ${cur.x},${cur.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}
