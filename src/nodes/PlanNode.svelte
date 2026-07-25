<script>
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { VERDICTS, VERDICT_MAP } from '../lib/feedback.svelte.js';

  let { id, data, selected } = $props();

  const review = getContext('review');
  const spec = $derived(data.spec);

  const entry = $derived(review.fb.nodes[id] || {});
  const verdict = $derived(entry.verdict || null);
  const comment = $derived((entry.comment || '').trim());

  const KIND_GLYPH = {
    component: '▣',
    work: '◆',
    data: '▤',
    external: '☁',
    decision: '◈',
    ui: '▭',
  };

  const STATUS_LABEL = {
    done: 'done',
    active: 'in flight',
    planned: 'planned',
    risk: 'risk',
    blocked: 'blocked',
  };
</script>

<div
  class="plan-node"
  class:selected
  class:has-verdict={!!verdict}
  data-verdict={verdict}
  data-status={spec.status || 'planned'}
>
  <Handle type="target" position={Position.Left} id="l" />
  <Handle type="target" position={Position.Top} id="t" />

  <div class="head">
    <span class="kind" title={spec.kind || 'component'}>{KIND_GLYPH[spec.kind] || '▣'}</span>
    <span class="title">{spec.text}</span>
    {#if verdict}
      <span class="verdict-badge" title={VERDICT_MAP[verdict].label}>{VERDICT_MAP[verdict].glyph}</span>
    {/if}
  </div>

  {#if spec.detail}
    <div class="detail">{spec.detail}</div>
  {/if}

  <div class="foot">
    {#if spec.status}
      <span class="status">{STATUS_LABEL[spec.status] || spec.status}</span>
    {/if}
    {#if spec.file}
      <span class="file">{spec.file}</span>
    {/if}
    {#if comment}
      <span class="comment-flag" title={comment}>💬</span>
    {/if}
  </div>

  <div class="quick">
    {#each VERDICTS as v}
      <button
        class="q"
        class:on={verdict === v.key}
        data-hue={v.hue}
        title={`${v.label} — ${v.hint}`}
        onclick={(e) => {
          e.stopPropagation();
          review.setVerdict(id, v.key);
        }}>{v.glyph}</button
      >
    {/each}
  </div>

  <Handle type="source" position={Position.Right} id="r" />
  <Handle type="source" position={Position.Bottom} id="b" />
</div>

<style>
  .plan-node {
    position: relative;
    width: max-content;
    max-width: 208px;
    min-width: 118px;
    padding: 9px 11px 8px;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-left: 3px solid var(--s-planned);
    border-radius: var(--radius);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .plan-node[data-status='done'] { border-left-color: var(--s-done); }
  .plan-node[data-status='active'] { border-left-color: var(--s-active); }
  .plan-node[data-status='planned'] { border-left-color: var(--s-planned); }
  .plan-node[data-status='risk'] { border-left-color: var(--s-risk); }
  .plan-node[data-status='blocked'] { border-left-color: var(--s-blocked); }

  .plan-node.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(90, 162, 255, 0.28);
  }
  .plan-node.has-verdict[data-verdict='first'] { background: color-mix(in srgb, var(--v-first) 11%, var(--bg-2)); }
  .plan-node.has-verdict[data-verdict='keep'] { background: color-mix(in srgb, var(--v-keep) 10%, var(--bg-2)); }
  .plan-node.has-verdict[data-verdict='change'] { background: color-mix(in srgb, var(--v-change) 11%, var(--bg-2)); }
  .plan-node.has-verdict[data-verdict='cut'] {
    background: color-mix(in srgb, var(--v-cut) 10%, var(--bg-2));
    opacity: 0.72;
  }
  .plan-node.has-verdict[data-verdict='cut'] .title { text-decoration: line-through; }

  .head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .kind {
    color: var(--ink-3);
    font-size: 11px;
    line-height: 1;
  }
  .title {
    font-weight: 600;
    font-size: 12.5px;
    line-height: 1.25;
    letter-spacing: -0.005em;
  }
  .verdict-badge {
    margin-left: auto;
    font-size: 11px;
    line-height: 1;
  }
  .plan-node[data-verdict='first'] .verdict-badge { color: var(--v-first); }
  .plan-node[data-verdict='keep'] .verdict-badge { color: var(--v-keep); }
  .plan-node[data-verdict='change'] .verdict-badge { color: var(--v-change); }
  .plan-node[data-verdict='cut'] .verdict-badge { color: var(--v-cut); }

  /* Two lines on the canvas keeps every box a similar height so ELK stays compact;
     the full text is always in the review panel. */
  .detail {
    margin-top: 3px;
    color: var(--ink-2);
    font-size: 11px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 6px;
    font-size: 10px;
    color: var(--ink-3);
  }
  .status {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .plan-node[data-status='done'] .status { color: var(--s-done); }
  .plan-node[data-status='active'] .status { color: var(--s-active); }
  .plan-node[data-status='risk'] .status { color: var(--s-risk); }
  .plan-node[data-status='blocked'] .status { color: var(--s-blocked); }
  .file { font-family: var(--mono); }
  .comment-flag { margin-left: auto; font-size: 10px; }

  .quick {
    position: absolute;
    top: -13px;
    right: 6px;
    display: none;
    gap: 2px;
    padding: 2px;
    background: var(--bg-3);
    border: 1px solid var(--line-2);
    border-radius: 7px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    z-index: 5;
  }
  .plan-node:hover .quick { display: flex; }
  .q {
    width: 19px;
    height: 17px;
    border-radius: 5px;
    font-size: 10px;
    line-height: 1;
    color: var(--ink-3);
  }
  .q:hover { background: var(--line); color: var(--ink); }
  .q.on[data-hue='first'] { background: var(--v-first); color: #23180a; }
  .q.on[data-hue='keep'] { background: var(--v-keep); color: #082014; }
  .q.on[data-hue='change'] { background: var(--v-change); color: #06172c; }
  .q.on[data-hue='cut'] { background: var(--v-cut); color: #2a0810; }
</style>
