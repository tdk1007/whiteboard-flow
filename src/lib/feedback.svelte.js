import { saveFeedback } from './api.js';

/**
 * The whole point of the spike: reviewer feedback is *typed data*, not shapes to
 * be diffed. Everything the reviewer does lands in this object and is written to
 * `feedback.json`, which `read_feedback.py` turns into a steering digest.
 */
export const VERDICTS = [
  { key: 'first', label: 'Do first', glyph: '▲', hint: 'Reprioritise — this comes before the rest', hue: 'first' },
  { key: 'keep', label: 'Keep', glyph: '✓', hint: 'Right as drawn, no change', hue: 'keep' },
  { key: 'change', label: 'Change', glyph: '✎', hint: 'Keep it but change it — say how in the comment', hue: 'change' },
  { key: 'cut', label: 'Cut', glyph: '✕', hint: 'Drop this from the plan', hue: 'cut' },
];

export const VERDICT_MAP = Object.fromEntries(VERDICTS.map((v) => [v.key, v]));

export function emptyFeedback() {
  return {
    version: 1,
    reviewer: '',
    updated: null,
    nodes: {}, // id -> {verdict, comment}
    edges: {}, // edgeId -> {verdict, comment}
    proposedNodes: [], // {id, text, detail, group, comment}
    proposedEdges: [], // {id, from, to, text, comment}
    marks: [], // freehand: {id, type:'ink'|'text'|'arrow'|'region', geom…, color, anchors:[nodeId]}
    answers: {}, // question index -> text
    general: '',
  };
}

/**
 * Guard the one input we don't control: whatever is already in feedback.json.
 * A duplicate id in a keyed `{#each}` is a fatal Svelte error — it takes the
 * whole board down rather than dropping one mark — so never hand the renderer a
 * list that could contain one.
 */
function dedupe(items) {
  const seen = new Set();
  return (items || []).filter((it) => {
    const id = it?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function createFeedbackStore(initial) {
  const seed = { ...emptyFeedback(), ...(initial || {}) };
  seed.marks = dedupe(seed.marks);
  seed.proposedNodes = dedupe(seed.proposedNodes);
  seed.proposedEdges = dedupe(seed.proposedEdges);
  const fb = $state(seed);
  let status = $state('idle'); // idle | dirty | saving | saved | error
  let timer = null;

  // Undo is scoped to *drawing* on purpose. A pen with no undo is unusable, but
  // silently reversing verdicts and comments with the same keystroke would be a
  // trap — those are single deliberate clicks with visible state.
  let undoStack = $state([]);
  const pushUndo = (op) => {
    undoStack = [...undoStack.slice(-49), op];
  };

  function flush() {
    status = 'saving';
    fb.updated = new Date().toISOString();
    const snap = $state.snapshot(fb);
    // `__fresh` is a transient "open me in rename mode" flag; persisting it would
    // put every proposed box back into edit mode on the next load.
    snap.proposedNodes = snap.proposedNodes.map(({ __fresh, ...rest }) => rest);
    snap.marks = (snap.marks || [])
      .filter((m) => m.type !== 'text' || (m.text || '').trim()) // never persist an empty label
      .map(({ __fresh, ...rest }) => rest);
    saveFeedback(snap)
      .then(() => {
        status = 'saved';
      })
      .catch(() => {
        status = 'error';
      });
  }

  function touch() {
    status = 'dirty';
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  }

  return {
    get fb() {
      return fb;
    },
    get status() {
      return status;
    },
    touch,
    flush,

    setVerdict(nodeId, verdict) {
      const cur = fb.nodes[nodeId] || {};
      fb.nodes[nodeId] = { ...cur, verdict: cur.verdict === verdict ? null : verdict };
      touch();
    },
    setComment(nodeId, comment) {
      fb.nodes[nodeId] = { ...(fb.nodes[nodeId] || {}), comment };
      touch();
    },
    setEdgeVerdict(edgeId, verdict) {
      const cur = fb.edges[edgeId] || {};
      fb.edges[edgeId] = { ...cur, verdict: cur.verdict === verdict ? null : verdict };
      touch();
    },
    setEdgeComment(edgeId, comment) {
      fb.edges[edgeId] = { ...(fb.edges[edgeId] || {}), comment };
      touch();
    },
    addProposedNode(node) {
      fb.proposedNodes = [...fb.proposedNodes, node];
      touch();
    },
    updateProposedNode(id, patch) {
      fb.proposedNodes = fb.proposedNodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
      touch();
    },
    removeProposedNode(id) {
      fb.proposedNodes = fb.proposedNodes.filter((n) => n.id !== id);
      fb.proposedEdges = fb.proposedEdges.filter((e) => e.from !== id && e.to !== id);
      touch();
    },
    addProposedEdge(edge) {
      if (fb.proposedEdges.some((e) => e.from === edge.from && e.to === edge.to)) return;
      fb.proposedEdges = [...fb.proposedEdges, edge];
      touch();
    },
    updateProposedEdge(id, patch) {
      fb.proposedEdges = fb.proposedEdges.map((e) => (e.id === id ? { ...e, ...patch } : e));
      touch();
    },
    removeProposedEdge(id) {
      fb.proposedEdges = fb.proposedEdges.filter((e) => e.id !== id);
      touch();
    },
    // ----------------------------------------------------------- freehand marks
    addMark(mark) {
      fb.marks = [...fb.marks, mark];
      pushUndo({ kind: 'add', marks: [mark.id] });
      touch();
    },
    updateMark(id, patch) {
      fb.marks = fb.marks.map((m) => (m.id === id ? { ...m, ...patch } : m));
      touch();
    },
    removeMarks(ids) {
      const set = new Set(ids);
      const gone = fb.marks.filter((m) => set.has(m.id));
      if (!gone.length) return;
      fb.marks = fb.marks.filter((m) => !set.has(m.id));
      pushUndo({ kind: 'remove', snapshot: $state.snapshot(gone) });
      touch();
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get markCount() {
      return fb.marks.length;
    },
    undoDrawing() {
      const op = undoStack[undoStack.length - 1];
      if (!op) return null;
      undoStack = undoStack.slice(0, -1);
      if (op.kind === 'add') {
        const set = new Set(op.marks);
        fb.marks = fb.marks.filter((m) => !set.has(m.id));
      } else {
        fb.marks = [...fb.marks, ...op.snapshot];
      }
      touch();
      return op.kind;
    },

    setAnswer(i, text) {
      fb.answers[String(i)] = text;
      touch();
    },
    setGeneral(text) {
      fb.general = text;
      touch();
    },
    setReviewer(name) {
      fb.reviewer = name;
      touch();
    },
  };
}

/** How much of the board has actually been reviewed. */
export function reviewProgress(board, fb) {
  const ids = (board.nodes || []).map((n) => n.id);
  const touched = ids.filter((id) => {
    const e = fb.nodes[id];
    return e && (e.verdict || (e.comment || '').trim());
  });
  return { done: touched.length, total: ids.length };
}

export function signalCount(fb) {
  let n = 0;
  for (const v of Object.values(fb.nodes)) if (v && (v.verdict || (v.comment || '').trim())) n++;
  for (const v of Object.values(fb.edges)) if (v && (v.verdict || (v.comment || '').trim())) n++;
  n += fb.proposedNodes.length + fb.proposedEdges.length;
  n += (fb.marks || []).filter((m) => m.type !== 'text' || (m.text || '').trim()).length;
  for (const a of Object.values(fb.answers)) if ((a || '').trim()) n++;
  if ((fb.general || '').trim()) n++;
  return n;
}
