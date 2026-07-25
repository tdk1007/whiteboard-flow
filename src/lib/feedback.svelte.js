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
    answers: {}, // question index -> text
    general: '',
  };
}

export function createFeedbackStore(initial) {
  const fb = $state({ ...emptyFeedback(), ...(initial || {}) });
  let status = $state('idle'); // idle | dirty | saving | saved | error
  let timer = null;

  function flush() {
    status = 'saving';
    fb.updated = new Date().toISOString();
    const snap = $state.snapshot(fb);
    // `__fresh` is a transient "open me in rename mode" flag; persisting it would
    // put every proposed box back into edit mode on the next load.
    snap.proposedNodes = snap.proposedNodes.map(({ __fresh, ...rest }) => rest);
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
  for (const a of Object.values(fb.answers)) if ((a || '').trim()) n++;
  if ((fb.general || '').trim()) n++;
  return n;
}
