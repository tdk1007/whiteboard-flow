<script>
  import { setContext, onMount, tick } from 'svelte';
  import { SvelteFlow, Background, Controls, BackgroundVariant, Position } from '@xyflow/svelte';
  import { createFeedbackStore } from './lib/feedback.svelte.js';
  import { runLayout, GROUP_PREFIX } from './lib/layout.js';
  import PlanNode from './nodes/PlanNode.svelte';
  import ProposedNode from './nodes/ProposedNode.svelte';
  import GroupNode from './nodes/GroupNode.svelte';
  import RoutedEdge from './edges/RoutedEdge.svelte';
  import ProposedEdge from './edges/ProposedEdge.svelte';
  import TopBar from './panels/TopBar.svelte';
  import ReviewPanel from './panels/ReviewPanel.svelte';
  import DrawToolbar from './canvas/DrawToolbar.svelte';
  import MarkLayer from './canvas/MarkLayer.svelte';
  import { simplify, normRect, markBounds, anchorsFor, boxAt, markHit, translateMark, PEN_COLORS } from './lib/ink.js';

  let { board } = $props();

  const review = createFeedbackStore(board.feedback);
  setContext('review', review);

  const nodeTypes = { plan: PlanNode, proposed: ProposedNode, group: GroupNode };
  const edgeTypes = { routed: RoutedEdge, proposed: ProposedEdge };

  let nodes = $state.raw([]);
  let edges = $state.raw([]);
  let viewport = $state.raw({ x: 0, y: 0, zoom: 1 });
  let phase = $state('measuring'); // measuring | ready
  let selection = $state(null); // {kind:'node'|'proposed'|'edge', id, edge?}
  let paneEl = $state(null);
  let lastBounds = null;
  let propCounter = review.fb.proposedNodes.length;

  // ------------------------------------------------------------------ drawing
  let tool = $state('select'); // select | pen | marker | text | box | region | arrow | eraser
  let penColor = $state(PEN_COLORS[0].hex);
  let draft = $state(null); // the mark currently under the cursor
  let editingMark = $state(null); // id of the text mark being typed into
  let hint = $state(null);
  let hintTimer = null;
  let markCounter = review.fb.marks.length;
  const drawTool = $derived(tool !== 'select');

  function say(msg) {
    hint = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = null), 2600);
  }

  const TOOL_HINT = {
    pen: 'Pen — drag to draw. Colour picker on the left.',
    marker: 'Highlighter — drag over what matters.',
    text: 'Text — click anywhere to drop a note.',
    box: 'Box — drag out a box, then name it. It joins the plan as proposed work.',
    region: 'Region — drag around a cluster of boxes.',
    arrow: 'Arrow — drag between two boxes and it reads as “X → Y”.',
    eraser: 'Eraser — click or drag across markup.',
  };

  function setTool(next) {
    if (next === tool) next = 'select';
    tool = next;
    draft = null;
    drawing = null;
    if (editingMark) commitText(editingMark, review.fb.marks.find((m) => m.id === editingMark)?.text);
    if (TOOL_HINT[next]) say(TOOL_HINT[next]);
    else hint = null;
  }

  const isDown = (board.direction || 'RIGHT').toUpperCase() === 'DOWN';
  const SRC_POS = isDown ? Position.Bottom : Position.Right;
  const TGT_POS = isDown ? Position.Top : Position.Left;

  // ---------------------------------------------------------------- measuring
  // tldraw taught us this the hard way: laying out against guessed box sizes puts
  // routes inside boxes. Render once, measure what the browser actually drew,
  // then run ELK against the truth.
  function measureNodes() {
    const all = [
      ...board.nodes.map((n) => ({ id: n.id, type: 'plan', data: { spec: n } })),
      ...review.fb.proposedNodes.map((n) => ({ id: n.id, type: 'proposed', data: { spec: n } })),
    ];
    return all.map((n, i) => ({ ...n, position: { x: (i % 6) * 300, y: Math.floor(i / 6) * 160 }, draggable: false }));
  }

  // NB: timers, not requestAnimationFrame — rAF is suspended while the tab is in
  // the background, which would leave the board stuck on "laying out…" forever
  // for anyone who opens a board and switches away.
  const nextTick = (ms = 16) => new Promise((r) => setTimeout(r, ms));

  async function readSizes(ids) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await nextTick();
      const sizes = new Map();
      let missing = false;
      for (const id of ids) {
        const el = document.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
        if (!el || !el.offsetWidth) {
          missing = true;
          break;
        }
        sizes.set(id, { width: el.offsetWidth, height: el.offsetHeight });
      }
      if (!missing) return sizes;
    }
    return new Map(ids.map((id) => [id, { width: 190, height: 62 }]));
  }

  // ------------------------------------------------------------------ layout
  /** Absolute flow-space origin of every real box, no DOM needed. */
  function origins() {
    const m = new Map();
    for (const n of nodes) {
      if (n.type !== 'plan' && n.type !== 'proposed') continue;
      const p = n.parentId ? nodes.find((g) => g.id === n.parentId) : null;
      m.set(n.id, { x: (p ? p.position.x : 0) + n.position.x, y: (p ? p.position.y : 0) + n.position.y });
    }
    return m;
  }

  /**
   * Keep freehand markup stuck to the box it was drawn on.
   *
   * Marks are stored in flow coordinates, but flow coordinates are only as stable
   * as the layout — and the layout moves for all sorts of reasons: a re-layout, a
   * proposed box getting a longer name, or the agent editing board.json between
   * rounds. Each mark remembers where its anchor box was when it was drawn, so we
   * can re-seat it wherever that box has since ended up. A circle drawn around the
   * decision engine stays around the decision engine.
   *
   * Marks with no anchor (drawn in open space) have nothing to follow and stay put.
   */
  function reconcileMarks() {
    const now = origins();
    let moved = 0;
    for (const m of review.fb.marks) {
      const o = m.origin;
      if (!o || !now.has(o.id)) continue;
      const cur = now.get(o.id);
      const dx = cur.x - o.x;
      const dy = cur.y - o.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      review.updateMark(m.id, { ...translateMark(m, dx, dy), origin: { id: o.id, x: cur.x, y: cur.y } });
      moved++;
    }
    // marks saved before this existed: adopt the current position as their baseline
    for (const m of review.fb.marks) {
      if (m.origin) continue;
      const a = (m.anchors || []).find((id) => now.has(id));
      if (a) review.updateMark(m.id, { origin: { id: a, ...now.get(a) } });
    }
    return moved;
  }

  /** Where a mark's anchor box sits right now — its baseline for re-seating. */
  function originFor(anchors, boxes) {
    const b = boxes.find((x) => x.id === anchors?.[0]);
    return b ? { id: b.id, x: b.x, y: b.y } : null;
  }

  async function relayout({ refit = true } = {}) {
    phase = 'measuring';
    nodes = measureNodes();
    edges = [];
    await tick();

    const ids = [...board.nodes.map((n) => n.id), ...review.fb.proposedNodes.map((n) => n.id)];
    const sizes = await readSizes(ids);

    const { nodePos, groupBoxes, routes, bounds } = await runLayout(board, sizes, {
      proposedNodes: review.fb.proposedNodes,
      proposedEdges: [],
    });

    const groupOf = new Map();
    for (const n of [...board.nodes, ...review.fb.proposedNodes]) if (n.group) groupOf.set(n.id, GROUP_PREFIX + n.group);

    const groupNodes = groupBoxes.map((g) => ({
      id: g.id,
      type: 'group',
      position: { x: g.x, y: g.y },
      width: g.width,
      height: g.height,
      data: { label: g.label },
      draggable: false,
      selectable: false,
      focusable: false,
      deletable: false,
      zIndex: -1,
    }));

    const planNodes = board.nodes.map((n) => ({
      id: n.id,
      type: 'plan',
      position: nodePos.get(n.id) || { x: 0, y: 0 },
      data: { spec: n },
      parentId: groupOf.get(n.id),
      deletable: false,
      sourcePosition: SRC_POS,
      targetPosition: TGT_POS,
    }));

    const propNodes = review.fb.proposedNodes.map((n) => {
      const p = nodePos.get(n.id) || { x: n.x || 0, y: n.y || 0 };
      return {
        id: n.id,
        type: 'proposed',
        position: p,
        data: { spec: n },
        parentId: groupOf.get(n.id),
        sourcePosition: SRC_POS,
        targetPosition: TGT_POS,
      };
    });

    nodes = [...groupNodes, ...planNodes, ...propNodes];
    edges = [
      ...routes.map((r) => ({
        id: r.id,
        source: r.from,
        target: r.to,
        type: 'routed',
        selectable: true,
        deletable: false,
        data: r,
      })),
      ...proposedFlowEdges(),
    ];

    const moved = reconcileMarks();
    if (moved) say(`re-laid out — ${moved} mark${moved === 1 ? '' : 's'} followed its box`);

    lastBounds = bounds;
    phase = 'ready';
    // a beat after the flow mounts, so our camera wins any library-side init
    if (refit) {
      await nextTick(32);
      fit(bounds);
    }
  }

  function proposedFlowEdges() {
    return review.fb.proposedEdges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'proposed',
      selectable: true,
      zIndex: 10,
      data: { proposed: true, ...e },
    }));
  }

  function fit(bounds) {
    if (!paneEl) return;
    const pad = 56;
    const w = paneEl.clientWidth;
    const h = paneEl.clientHeight;
    const zoom = Math.max(
      0.2,
      Math.min(1.1, (w - pad * 2) / Math.max(1, bounds.width), (h - pad * 2) / Math.max(1, bounds.height))
    );
    viewport = {
      x: (w - bounds.width * zoom) / 2,
      y: (h - bounds.height * zoom) / 2,
      zoom,
    };
  }

  let layoutError = $state(null);

  function safeRelayout(opts) {
    layoutError = null;
    relayout(opts).catch((e) => {
      layoutError = String(e?.message || e);
      phase = 'ready'; // show the board rather than an eternal splash
      console.error('[whiteboard-flow] layout failed', e);
    });
  }

  onMount(() => {
    safeRelayout();

    // Scripting/automation handle, same idea as `window.editor` in the tldraw
    // build. Also the only way to exercise the connect path in a headless run:
    // Svelte Flow leaves nodes visibility:hidden until its ResizeObserver has
    // measured them, which never happens in a background tab, so the handles
    // aren't hit-testable there.
    window.__wbflow = {
      get board() { return board; },
      get nodes() { return nodes; },
      get edges() { return edges; },
      get feedback() { return $state.snapshot(review.fb); },
      get layout() { return lastBounds; },
      connect: (source, target) => onConnect({ source, target }),
      select: selectNode,
      focus: focusNode,
      relayout: () => safeRelayout(),
      save: () => review.flush(),

      // Drawing, scriptable. Pointer drags can't be synthesised in a background
      // tab (see the ResizeObserver note above), so these are how the freehand
      // paths get exercised — they run the same commit code the pointer does.
      get marks() { return $state.snapshot(review.fb.marks); },
      get boxes() { return allBoxes(); },
      tool: (t) => setTool(t),
      color: (c) => (penColor = c),
      ink: (points, opts = {}) =>
        commitDraft({ id: nextMarkId('ink'), type: 'ink', points, color: penColor, width: 3, ...opts }),
      arrow: (from, to, opts = {}) =>
        commitDraft({ id: nextMarkId('arrow'), type: 'arrow', from, to, color: penColor, ...opts }),
      region: (x, y, w, h, opts = {}) =>
        commitDraft({ id: nextMarkId('region'), type: 'region', x, y, w, h, color: penColor, ...opts }),
      note: (x, y, text, opts = {}) => {
        const id = nextMarkId('text');
        review.addMark({ id, type: 'text', x, y, text, color: penColor, anchors: [], ...opts });
        commitText(id, text);
        return id;
      },
      erase: (x, y) => eraseAt({ x, y }),
      clearMarks,
      undo: () => review.undoDrawing(),
    };
  });

  // -------------------------------------------------------------- selection
  // A whole-board fit is an overview, not a reading zoom. Selecting a box moves
  // the camera to it so the label is legible while you're judging it.
  const READ_ZOOM = 0.92;
  let animating = $state(false);
  let animTimer = null;

  function nodeBox(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return null;
    const p = n.parentId ? nodes.find((g) => g.id === n.parentId) : null;
    const el = document.querySelector(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
    return {
      x: (p ? p.position.x : 0) + n.position.x,
      y: (p ? p.position.y : 0) + n.position.y,
      w: el?.offsetWidth || 180,
      h: el?.offsetHeight || 60,
    };
  }

  function focusNode(id, { force = false } = {}) {
    const b = nodeBox(id);
    if (!b || !paneEl) return;
    const pw = paneEl.clientWidth;
    const ph = paneEl.clientHeight;
    const z = viewport.zoom < 0.8 ? READ_ZOOM : viewport.zoom;

    if (!force && z === viewport.zoom) {
      // already readable — only recentre if the box isn't comfortably on screen
      const sx = b.x * z + viewport.x;
      const sy = b.y * z + viewport.y;
      const pad = 40;
      const onscreen = sx > pad && sy > pad && sx + b.w * z < pw - pad && sy + b.h * z < ph - pad;
      if (onscreen) return;
    }

    // never glide under a pen — the ink would trail behind the moving board
    animating = !drawTool;
    clearTimeout(animTimer);
    animTimer = setTimeout(() => (animating = false), 300);
    viewport = { x: pw / 2 - (b.x + b.w / 2) * z, y: ph / 2 - (b.y + b.h / 2) * z, zoom: z };
  }

  function selectNode(id) {
    const isProposed = review.fb.proposedNodes.some((n) => n.id === id);
    selection = { kind: isProposed ? 'proposed' : 'node', id };
    focusNode(id);
  }

  function nextUnreviewed() {
    const list = board.nodes;
    const start = selection?.kind === 'node' ? list.findIndex((n) => n.id === selection.id) : -1;
    for (let i = 1; i <= list.length; i++) {
      const n = list[(start + i + list.length) % list.length];
      const e = review.fb.nodes[n.id];
      if (!e || (!e.verdict && !(e.comment || '').trim())) {
        selection = { kind: 'node', id: n.id };
        focusNode(n.id, { force: true });
        return;
      }
    }
    selection = null;
  }

  // ------------------------------------------------------------ interaction
  /** Screen → flow coordinates.
   *
   *  Read the transform the viewport is *actually wearing* rather than the
   *  `viewport` state: selecting a box glides the camera over 260ms, and during
   *  that glide the state already holds the destination. Anything drawn mid-glide
   *  would be committed at coordinates the reviewer never saw. */
  function flowPos(clientX, clientY) {
    const r = paneEl.getBoundingClientRect();
    const el = paneEl.querySelector('.svelte-flow__viewport');
    if (el) {
      const t = getComputedStyle(el).transform;
      if (t && t !== 'none') {
        const m = new DOMMatrixReadOnly(t);
        return { x: (clientX - r.left - m.e) / m.a, y: (clientY - r.top - m.f) / m.d };
      }
    }
    return {
      x: (clientX - r.left - viewport.x) / viewport.zoom,
      y: (clientY - r.top - viewport.y) / viewport.zoom,
    };
  }

  /** Every plan/proposed box as an absolute flow-space rect — what freehand marks
   *  get anchored against so a scribble can name what it was drawn over. */
  function allBoxes() {
    return nodes
      .filter((n) => n.type === 'plan' || n.type === 'proposed')
      .map((n) => {
        const b = nodeBox(n.id);
        return b ? { id: n.id, x: b.x, y: b.y, w: b.w, h: b.h } : null;
      })
      .filter(Boolean);
  }

  const nextMarkId = (kind) => `mk-${kind}-${++markCounter}`;

  // -------------------------------------------------------- draw interaction
  // One pointer handler for every drawing tool, on `.pane` in the CAPTURE phase
  // so a stroke can start on top of a node without the node swallowing it.
  let drawing = null; // {type, points|from, id}

  function onPanePointerDown(event) {
    if (!drawTool || event.button !== 0) return;
    // chrome of our own — toolbar, zoom controls, a label being edited
    if (event.target.closest('.toolbar, .svelte-flow__controls, .label-edit')) return;

    const p = flowPos(event.clientX, event.clientY);
    event.stopPropagation();
    event.preventDefault();

    if (tool === 'eraser') {
      drawing = { type: 'erase' };
      eraseAt(p);
      return;
    }
    if (tool === 'text') {
      addTextMark(p);
      return;
    }

    const id = nextMarkId(tool);
    if (tool === 'pen' || tool === 'marker') {
      draft = {
        id,
        type: 'ink',
        points: [[p.x, p.y]],
        color: penColor,
        width: tool === 'marker' ? 14 : 3,
        highlight: tool === 'marker',
      };
    } else if (tool === 'arrow') {
      draft = { id, type: 'arrow', from: [p.x, p.y], to: [p.x, p.y], color: penColor };
    } else {
      // box | region — both drag out a rectangle, they just commit differently
      draft = { id, type: 'region', x: p.x, y: p.y, w: 0, h: 0, color: penColor, __start: [p.x, p.y], __as: tool };
    }
    drawing = { type: tool, start: [p.x, p.y] };
  }

  function onPanePointerMove(event) {
    if (!drawing) return;
    const p = flowPos(event.clientX, event.clientY);

    if (drawing.type === 'erase') return eraseAt(p);
    if (!draft) return;

    if (draft.type === 'ink') {
      const last = draft.points[draft.points.length - 1];
      // 2px of movement before we record — raw pointermove is far denser than useful.
      // Round on the way in too: sub-pixel precision is invisible and triples the
      // size of feedback.json.
      if (Math.hypot(p.x - last[0], p.y - last[1]) < 2) return;
      draft = { ...draft, points: [...draft.points, [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]] };
    } else if (draft.type === 'arrow') {
      draft = { ...draft, to: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] };
    } else {
      draft = { ...draft, ...normRect(draft.__start, [p.x, p.y]) };
    }
  }

  function onPanePointerUp() {
    if (!drawing) return;
    const d = draft;
    drawing = null;
    draft = null;
    if (d) commitDraft(d);
  }

  /** Turn a finished draft into a stored mark. The pointer handler and the
   *  scripting API both come through here so they can't drift apart. */
  function commitDraft(d) {
    const boxes = allBoxes();

    if (d.type === 'ink') {
      if (d.points.length < 2) return null; // a stray click isn't a stroke
      const mark = { ...d, points: simplify(d.points) };
      const anchors = anchorsFor(markBounds(mark), boxes);
      review.addMark({ ...mark, anchors, origin: originFor(anchors, boxes) });
      return mark.id;
    }

    if (d.type === 'arrow') {
      if (Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) < 12) return null;
      // Resolve both ends to boxes if we can — that turns "I drew an arrow" into
      // "X should feed Y", which the digest can actually state in words.
      const from = boxAt(d.from, boxes, 8);
      const to = boxAt(d.to, boxes, 8);
      const anchors = [from, to].filter(Boolean);
      review.addMark({ ...d, hitFrom: from, hitTo: to, anchors, origin: originFor(anchors, boxes) });
      if (from && to && from !== to) say(`arrow reads as ${labelOf(from)} → ${labelOf(to)}`);
      return d.id;
    }

    if (d.w < 16 || d.h < 12) return null; // too small to be deliberate
    if (d.__as === 'box') return addBoxNode(d);

    const { __start, __as, ...region } = d;
    const anchors = anchorsFor(markBounds(region), boxes);
    review.addMark({ ...region, anchors, origin: originFor(anchors, boxes) });
    return region.id;
  }

  function labelOf(id) {
    const n = [...board.nodes, ...review.fb.proposedNodes].find((x) => x.id === id);
    return (n?.text || id).replace(/\n/g, ' ');
  }

  function addTextMark(p) {
    const id = nextMarkId('text');
    review.addMark({ id, type: 'text', x: p.x, y: p.y, text: '', color: penColor, anchors: [] });
    editingMark = id;
  }

  /** The Box tool is deliberately NOT a drawing — it produces a real proposed
   *  node, so it lands in the plan as work rather than as decoration. */
  function addBoxNode(rect) {
    const id = `prop-${++propCounter}`;
    const spec = { id, text: '', comment: '', x: rect.x, y: rect.y, __fresh: true };
    review.addProposedNode(spec);
    nodes = [
      ...nodes,
      {
        id,
        type: 'proposed',
        position: { x: rect.x, y: rect.y },
        data: { spec },
        sourcePosition: SRC_POS,
        targetPosition: TGT_POS,
      },
    ];
    selection = { kind: 'proposed', id };
    tool = 'select'; // you drew a box to name it — let the keyboard reach the input
  }

  function eraseAt(p) {
    const doomed = review.fb.marks.filter((m) => markHit(m, [p.x, p.y], 12 / Math.max(viewport.zoom, 0.2)));
    if (doomed.length) review.removeMarks(doomed.map((m) => m.id));
  }

  function commitText(id, text) {
    editingMark = null;
    const t = (text || '').trim();
    if (!t) return review.removeMarks([id]);
    const m = review.fb.marks.find((x) => x.id === id);
    const boxes = allBoxes();
    const anchors = m ? anchorsFor(markBounds(m), boxes) : [];
    review.updateMark(id, { text: t, anchors, origin: originFor(anchors, boxes) });
  }

  function clearMarks() {
    review.removeMarks(review.fb.marks.map((m) => m.id));
    say('markup cleared — ⌘Z brings it back');
  }

  function onPaneDblClick(event) {
    if (drawTool) return;
    if (event.target.closest('.svelte-flow__node, .label-wrap')) return;
    const p = flowPos(event.clientX, event.clientY);
    const id = `prop-${++propCounter}`;
    review.addProposedNode({ id, text: '', comment: '', x: p.x, y: p.y, __fresh: true });
    nodes = [
      ...nodes,
      {
        id,
        type: 'proposed',
        position: p,
        data: { spec: { id, text: '', comment: '', __fresh: true } },
        sourcePosition: SRC_POS,
        targetPosition: TGT_POS,
      },
    ];
    selection = { kind: 'proposed', id };
  }

  function onConnect(conn) {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const id = `pe-${conn.source}->${conn.target}`;
    review.addProposedEdge({ id, from: conn.source, to: conn.target, comment: '' });
    edges = [...edges.filter((e) => e.id !== id), ...proposedFlowEdges().filter((e) => e.id === id)];
    selection = { kind: 'edge', id, edge: { id, from: conn.source, to: conn.target, proposed: true } };
  }

  // Backspace only reaches the reviewer's own proposals — everything seeded from
  // board.json is marked undeletable, so the plan can't be edited away by accident.
  function onDelete({ nodes: dn, edges: de }) {
    for (const n of dn) review.removeProposedNode(n.id);
    for (const e of de) review.removeProposedEdge(e.id);
    if (selection && (dn.some((n) => n.id === selection.id) || de.some((e) => e.id === selection.id))) {
      selection = null;
    }
  }

  const TOOL_KEYS = { v: 'select', p: 'pen', h: 'marker', t: 'text', b: 'box', r: 'region', a: 'arrow', e: 'eraser' };

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // a proposed node mid-rename, or a note being typed, owns the keyboard even if focus slipped
    if (document.querySelector('.proposed-node input, .label-edit')) return;

    // Drawing undo — the one modifier shortcut, and it only ever touches markup.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (!review.canUndo) return;
      e.preventDefault();
      say(review.undoDrawing() === 'add' ? 'undid last mark' : 'restored markup');
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (drawing || draft) {
        drawing = null;
        draft = null;
        return;
      }
      if (drawTool) {
        tool = 'select';
        return;
      }
      selection = null;
      return;
    }
    if (TOOL_KEYS[e.key]) {
      e.preventDefault();
      setTool(TOOL_KEYS[e.key]);
      return;
    }
    if (e.key === 'n') {
      e.preventDefault();
      nextUnreviewed();
      return;
    }
    const map = { 1: 'first', 2: 'keep', 3: 'change', 4: 'cut' };
    if (map[e.key] && selection) {
      e.preventDefault();
      if (selection.kind === 'node') review.setVerdict(selection.id, map[e.key]);
      else if (selection.kind === 'edge' && !selection.edge?.proposed) review.setEdgeVerdict(selection.id, map[e.key]);
    }
  }

  // keep proposed-edge list in the flow in sync when one is removed from the panel
  $effect(() => {
    const wanted = new Set(review.fb.proposedEdges.map((e) => e.id));
    const present = edges.filter((e) => e.type === 'proposed');
    if (present.length !== wanted.size || present.some((e) => !wanted.has(e.id))) {
      edges = [...edges.filter((e) => e.type !== 'proposed'), ...proposedFlowEdges()];
    }
  });

  // and drop removed proposed nodes from the canvas
  $effect(() => {
    const wanted = new Set(review.fb.proposedNodes.map((n) => n.id));
    const present = nodes.filter((n) => n.type === 'proposed');
    if (present.some((n) => !wanted.has(n.id))) {
      nodes = nodes.filter((n) => n.type !== 'proposed' || wanted.has(n.id));
      if (selection?.kind === 'proposed' && !wanted.has(selection.id)) selection = null;
    }
  });
</script>

<svelte:window onkeydown={onKey} onbeforeunload={() => review.flush()} />

<div class="shell">
  <TopBar {board} onrelayout={() => safeRelayout()} />
  <div class="body">
    <div
      class="pane"
      class:measuring={phase === 'measuring'}
      class:animating
      class:drawing={drawTool}
      data-tool={tool}
      bind:this={paneEl}
      ondblclick={onPaneDblClick}
      onpointerdowncapture={onPanePointerDown}
      onpointermove={onPanePointerMove}
      onpointerup={onPanePointerUp}
      onpointerleave={onPanePointerUp}
      role="application"
    >
      <SvelteFlow
        bind:nodes
        bind:edges
        bind:viewport
        {nodeTypes}
        {edgeTypes}
        minZoom={0.15}
        maxZoom={2.2}
        nodesDraggable={!drawTool}
        nodesConnectable={!drawTool}
        elementsSelectable={!drawTool}
        panOnDrag={drawTool ? [1, 2] : true}
        zoomOnDoubleClick={false}
        ondelete={onDelete}
        proOptions={{ hideAttribution: true }}
        onnodeclick={({ node }) => !drawTool && selectNode(node.id)}
        onedgeclick={({ edge }) => {
          if (drawTool) return;
          selection = { kind: 'edge', id: edge.id, edge: edge.data };
        }}
        onpaneclick={() => !drawTool && (selection = null)}
        onconnect={onConnect}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showLock={false} position="bottom-left" />
        <MarkLayer
          marks={review.fb.marks}
          {draft}
          editingId={editingMark}
          zoom={viewport.zoom}
          onedit={(id, text) => review.updateMark(id, { text })}
          oncommit={commitText}
          onbeginedit={(id) => (editingMark = id)}
        />
      </SvelteFlow>

      <DrawToolbar
        {tool}
        color={penColor}
        marks={review.markCount}
        canUndo={review.canUndo}
        ontool={setTool}
        oncolor={(c) => (penColor = c)}
        onundo={() => say(review.undoDrawing() === 'add' ? 'undid last mark' : 'restored markup')}
        onclear={clearMarks}
      />

      {#if hint}
        <div class="hint">{hint}</div>
      {/if}
      {#if phase === 'measuring'}
        <div class="splash"><span class="dot"></span> laying out…</div>
      {/if}
      {#if layoutError}
        <div class="layout-error">layout failed — {layoutError}</div>
      {/if}
    </div>

    <ReviewPanel
      {board}
      {selection}
      onnext={nextUnreviewed}
      onclear={() => (selection = null)}
    />
  </div>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  .body { flex: 1; display: flex; min-height: 0; }
  .pane { flex: 1; position: relative; min-width: 0; }
  /* a drawing tool owns the surface — no grab cursor, no text selection mid-stroke */
  .pane.drawing { cursor: crosshair; user-select: none; }
  .pane.drawing :global(.svelte-flow__pane) { cursor: crosshair; }
  .pane[data-tool='text'], .pane[data-tool='text'] :global(.svelte-flow__pane) { cursor: text; }
  .pane[data-tool='eraser'], .pane[data-tool='eraser'] :global(.svelte-flow__pane) { cursor: cell; }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    padding: 6px 12px;
    background: var(--bg-3);
    border: 1px solid var(--line-2);
    border-radius: 20px;
    color: var(--ink-2);
    font-size: 11.5px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  }
  .pane.measuring :global(.svelte-flow) { opacity: 0; }
  /* only while the camera is moving under our control — never during a user pan */
  .pane.animating :global(.svelte-flow__viewport) {
    transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .layout-error {
    position: absolute;
    left: 12px;
    top: 12px;
    padding: 7px 11px;
    background: var(--bg-3);
    border: 1px solid var(--v-cut);
    border-radius: 8px;
    color: var(--v-cut);
    font-size: 11.5px;
    max-width: 60%;
  }
  .splash {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    color: var(--ink-3);
    font-size: 12px;
    letter-spacing: 0.02em;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.15); }
  }
</style>
