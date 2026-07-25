<script>
  import { getContext } from 'svelte';
  import { routeToPath } from '../lib/layout.js';
  import { VERDICT_MAP } from '../lib/feedback.svelte.js';

  let { id, data, selected } = $props();

  const review = getContext('review');

  const pts = $derived(data.points || []);
  const d = $derived(routeToPath(pts));
  const entry = $derived(review.fb.edges[id] || {});
  const verdict = $derived(entry.verdict || null);
  const hasComment = $derived(!!(entry.comment || '').trim());

  const stroke = $derived(
    data.proposed
      ? 'var(--proposed)'
      : verdict === 'cut'
        ? 'var(--v-cut)'
        : verdict === 'first'
          ? 'var(--v-first)'
          : verdict
            ? 'var(--v-change)'
            : selected
              ? 'var(--accent)'
              : data.kind === 'data'
                ? '#4a7fa8'
                : '#4d5a6c'
  );

  // Arrowhead built from the last segment's direction — no <marker> defs needed,
  // so it inherits the resolved stroke colour directly.
  const head = $derived.by(() => {
    if (pts.length < 2) return '';
    const b = pts[pts.length - 1];
    const a = pts[pts.length - 2];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const L = 9;
    const W = 3.6;
    const p1 = { x: b.x - L * Math.cos(ang) + W * Math.sin(ang), y: b.y - L * Math.sin(ang) - W * Math.cos(ang) };
    const p2 = { x: b.x - L * Math.cos(ang) - W * Math.sin(ang), y: b.y - L * Math.sin(ang) + W * Math.cos(ang) };
    return `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
  });

  const labelW = $derived((data.text || '').length * 6.1 + 12);
</script>

{#if d}
  <!-- fat invisible path = generous click target for selecting the edge -->
  <path class="routed-edge__hit" {d} fill="none" stroke="transparent" stroke-width="16" />
  <g opacity={data.back && !selected && !verdict ? 0.42 : 1}>
    <path
      {d}
      fill="none"
      stroke={stroke}
      stroke-width={selected || verdict ? 2.2 : 1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-dasharray={data.proposed ? '6 5' : verdict === 'cut' ? '3 4' : data.back ? '2 5' : null}
    />
    <polygon points={head} fill={stroke} />
  </g>

  {#if data.text && data.labelX != null}
    <rect
      x={data.labelX - labelW / 2}
      y={data.labelY - 8}
      width={labelW}
      height={16}
      rx="4"
      fill="var(--bg)"
      opacity="0.92"
    />
    <text
      x={data.labelX}
      y={data.labelY}
      text-anchor="middle"
      dominant-baseline="central"
      class="lbl"
      fill={verdict || selected ? stroke : 'var(--ink-3)'}>{data.text}</text
    >
  {/if}

  {#if verdict || hasComment}
    <circle
      cx={pts[Math.floor(pts.length / 2)].x}
      cy={pts[Math.floor(pts.length / 2)].y}
      r="7"
      fill="var(--bg-3)"
      stroke={stroke}
      stroke-width="1.2"
    />
    <text
      x={pts[Math.floor(pts.length / 2)].x}
      y={pts[Math.floor(pts.length / 2)].y}
      text-anchor="middle"
      dominant-baseline="central"
      class="mark"
      fill={stroke}>{verdict ? VERDICT_MAP[verdict].glyph : '💬'}</text
    >
  {/if}
{/if}

<style>
  .lbl {
    font-family: var(--font);
    font-size: 11px;
    font-weight: 500;
    pointer-events: none;
  }
  .mark {
    font-family: var(--font);
    font-size: 9px;
    pointer-events: none;
  }
  .routed-edge__hit { cursor: pointer; }
</style>
