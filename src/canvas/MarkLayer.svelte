<script>
  /**
   * Freehand markup, drawn inside Svelte Flow's front viewport portal so it pans
   * and zooms with the board instead of floating over it in screen space.
   *
   * The layer is pointer-transparent — a scribble must never steal a click meant
   * for the box underneath, and erasing is hit-tested geometrically in Board so
   * that dragging the eraser through empty space still catches what it crosses.
   * Text labels are the one exception: they stay clickable so they can be edited.
   */
  import { ViewportPortal } from '@xyflow/svelte';
  import { inkPath, arrowHead, arrowPath, arrowTail, markBounds } from '../lib/ink.js';

  let {
    marks = [],
    draft = null,
    editingId = null,
    zoom = 1,
    onedit,
    oncommit,
    onbeginedit,
  } = $props();

  const inkish = $derived([...marks.filter((m) => m.type !== 'text'), ...(draft && draft.type !== 'text' ? [draft] : [])]);
  const labels = $derived([...marks.filter((m) => m.type === 'text'), ...(draft && draft.type === 'text' ? [draft] : [])]);

  /**
   * The SVG has to be a real, sized box over the content.
   *
   * A 0×0 `<svg>` with `overflow: visible` looks like it works — the DOM is there
   * and `getBoundingClientRect()` on the paths returns correct geometry — but
   * Chrome never paints it. Every stroke was invisible while the data underneath
   * was perfectly fine. So: size the element to the marks it holds and set a
   * matching viewBox, which keeps SVG user units identical to flow coordinates.
   */
  const PAD = 60; // stroke width and arrowheads bleed past the geometry
  const frame = $derived.by(() => {
    if (!inkish.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of inkish) {
      const b = markBounds(m);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    if (!Number.isFinite(x0)) return null;
    return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
  });

  // Strokes are stored in flow coordinates, so at low zoom they'd thin out to
  // nothing. Nudge the width back up as you zoom out so markup stays visible in
  // the overview — the same reason the board zooms in when you select a box.
  const lift = $derived(zoom < 1 ? Math.min(2, 1 / Math.max(zoom, 0.2)) : 1);

  function autosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  // Focus that survives the portal remount, same trick as ProposedNode.
  function focusText(el) {
    if (!el) return;
    el.focus();
    el.select?.();
    setTimeout(() => {
      if (document.activeElement !== el) {
        el.focus();
        el.select?.();
      }
    }, 60);
    autosize(el);
  }
</script>

<ViewportPortal target="front">
  <div class="mark-layer">
    {#if frame}
    <svg
      class="ink"
      style="left:{frame.x}px; top:{frame.y}px"
      width={frame.w}
      height={frame.h}
      viewBox="{frame.x} {frame.y} {frame.w} {frame.h}"
    >
      {#each inkish as m (m.id)}
        {#if m.type === 'ink'}
          <path
            d={inkPath(m.points)}
            stroke={m.color}
            stroke-width={(m.width || 3) * lift}
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
            opacity={m.highlight ? 0.34 : 1}
            style={m.highlight ? 'mix-blend-mode:screen' : null}
            class:draft={m === draft}
          />
        {:else if m.type === 'arrow'}
          <g class:draft={m === draft}>
            <!-- one path for both cases: `arrowPath` emits a plain L for an
                 arrow with no control points, so straight arrows are unchanged -->
            <path
              d={arrowPath(m)}
              stroke={m.color}
              stroke-width={2.2 * lift}
              stroke-linecap="round"
              fill="none"
            />
            <polygon points={arrowHead(arrowTail(m), m.to, 12 * lift)} fill={m.color} />
          </g>
        {:else if m.type === 'region'}
          <g class:draft={m === draft}>
            <rect
              x={m.x}
              y={m.y}
              width={m.w}
              height={m.h}
              rx={12}
              fill={m.color}
              fill-opacity="0.07"
              stroke={m.color}
              stroke-width={2 * lift}
              stroke-dasharray="9 6"
            />
          </g>
        {/if}
      {/each}
    </svg>
    {/if}

    {#each labels as m (m.id)}
      {@const b = markBounds(m)}
      <div class="label-wrap" style="left:{b.x}px; top:{b.y}px; max-width:{240 * lift}px; font-size:{14 * lift}px;">
        {#if editingId === m.id}
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            class="label-edit"
            style="color:{m.color}; border-color:{m.color};"
            rows="1"
            placeholder="type a note…"
            value={m.text || ''}
            use:focusText
            oninput={(e) => {
              autosize(e.currentTarget);
              onedit?.(m.id, e.currentTarget.value);
            }}
            onblur={(e) => oncommit?.(m.id, e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                oncommit?.(m.id, e.currentTarget.value);
              }
              e.stopPropagation();
            }}
          ></textarea>
        {:else}
          <button
            class="label"
            style="color:{m.color};"
            title="Double-click to edit"
            ondblclick={(e) => {
              e.stopPropagation();
              onbeginedit?.(m.id);
            }}>{m.text}</button
          >
        {/if}
      </div>
    {/each}
  </div>
</ViewportPortal>

<style>
  .mark-layer {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .ink {
    position: absolute;
    overflow: visible; /* belt and braces for stroke bleed past the padded frame */
  }
  .draft {
    opacity: 0.85;
  }

  .label-wrap {
    position: absolute;
    pointer-events: auto;
    /* the layer itself is a 0-width anchor, so a note has to size to its own
       content — without this every note wraps one character per line */
    width: max-content;
  }
  .label {
    display: block;
    padding: 2px 4px;
    font-size: inherit;
    font-weight: 600;
    line-height: 1.28;
    letter-spacing: -0.005em;
    text-align: left;
    white-space: pre-wrap;
    text-shadow: 0 1px 3px rgba(6, 10, 16, 0.95), 0 0 12px rgba(6, 10, 16, 0.7);
    cursor: text;
  }
  .label:hover {
    background: rgba(20, 26, 34, 0.6);
    border-radius: 5px;
  }
  .label-edit {
    width: 15em;
    min-height: 1.9em;
    padding: 3px 6px;
    font-size: inherit;
    font-weight: 600;
    line-height: 1.28;
    background: rgba(14, 17, 22, 0.94);
    border-width: 1px;
    border-radius: 6px;
    resize: none;
    overflow: hidden;
  }
</style>
