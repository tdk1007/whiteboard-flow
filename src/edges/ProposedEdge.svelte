<script>
  import { getSmoothStepPath } from '@xyflow/svelte';
  import { getContext } from 'svelte';

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = $props();

  const review = getContext('review');
  const rec = $derived(review.fb.proposedEdges.find((e) => e.id === id));
  const hasComment = $derived(!!(rec?.comment || '').trim());

  const path = $derived(
    getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 })
  );
</script>

<path class="hit" d={path[0]} fill="none" stroke="transparent" stroke-width="16" />
<path
  d={path[0]}
  fill="none"
  stroke="var(--proposed)"
  stroke-width={selected ? 2.4 : 1.8}
  stroke-dasharray="6 5"
  stroke-linecap="round"
/>
<circle cx={path[1]} cy={path[2]} r="8" fill="var(--bg-3)" stroke="var(--proposed)" stroke-width="1.2" />
<text x={path[1]} y={path[2]} text-anchor="middle" dominant-baseline="central" fill="var(--proposed)" class="m">
  {hasComment ? '💬' : '+'}
</text>

<style>
  .hit { cursor: pointer; }
  .m { font-family: var(--font); font-size: 10px; font-weight: 700; pointer-events: none; }
</style>
