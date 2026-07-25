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

    animating = true;
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
  function flowPos(clientX, clientY) {
    const r = paneEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - viewport.x) / viewport.zoom,
      y: (clientY - r.top - viewport.y) / viewport.zoom,
    };
  }

  function onPaneDblClick(event) {
    if (event.target.closest('.svelte-flow__node')) return;
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

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // a proposed node mid-rename owns the keyboard even if focus slipped
    if (document.querySelector('.proposed-node input')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      selection = null;
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
      bind:this={paneEl}
      ondblclick={onPaneDblClick}
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
        nodesConnectable={true}
        zoomOnDoubleClick={false}
        ondelete={onDelete}
        proOptions={{ hideAttribution: true }}
        onnodeclick={({ node }) => selectNode(node.id)}
        onedgeclick={({ edge }) => {
          selection = { kind: 'edge', id: edge.id, edge: edge.data };
        }}
        onpaneclick={() => (selection = null)}
        onconnect={onConnect}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showLock={false} position="bottom-left" />
      </SvelteFlow>

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
