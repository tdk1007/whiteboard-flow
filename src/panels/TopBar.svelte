<script>
  import { getContext } from 'svelte';
  import { reviewProgress, signalCount } from '../lib/feedback.svelte.js';
  import { SLUG } from '../lib/api.js';

  let { board, onrelayout } = $props();
  const review = getContext('review');

  const prog = $derived(reviewProgress(board, review.fb));
  const signals = $derived(signalCount(review.fb));
  const pct = $derived(prog.total ? Math.round((prog.done / prog.total) * 100) : 0);

  const cmd = $derived(`python3 "${board.readCmdBase || '~/Claude Code/whiteboard-flow/server'}/read_feedback.py" --slug ${SLUG}`);
  let copied = $state(false);

  const STATUS_TEXT = { idle: 'ready', dirty: 'saving…', saving: 'saving…', saved: 'feedback saved ✓', error: 'save failed ✕' };
</script>

<header class="bar">
  <div class="id">
    <div class="title">{board.title}</div>
    {#if board.subtitle}<div class="sub">{board.subtitle}</div>{/if}
  </div>

  <div class="meter" title="{prog.done} of {prog.total} boxes reviewed">
    <div class="track"><div class="fill" style="width:{pct}%"></div></div>
    <span class="num">{prog.done}/{prog.total} reviewed</span>
  </div>

  <div class="signals" title="Total feedback signals captured">
    <b>{signals}</b> signal{signals === 1 ? '' : 's'}
  </div>

  <input
    class="who"
    placeholder="your name"
    value={review.fb.reviewer}
    oninput={(e) => review.setReviewer(e.currentTarget.value)}
  />

  <div class="status" data-s={review.status}>{STATUS_TEXT[review.status]}</div>

  <button class="btn" onclick={onrelayout} title="Re-run ELK layout (after you've dragged things around)">Re-layout</button>

  <button
    class="btn accent"
    title="Copy the command that feeds this review back to Claude"
    onclick={async () => {
      await navigator.clipboard.writeText(cmd);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    }}>{copied ? 'copied ✓' : 'Copy ingest cmd'}</button
  >
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 14px;
    height: 50px;
    flex: none;
    background: var(--bg-2);
    border-bottom: 1px solid var(--line);
  }
  .id { min-width: 0; }
  .title { font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
  .sub {
    font-size: 11px;
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 460px;
  }
  .meter { margin-left: auto; display: flex; align-items: center; gap: 9px; }
  .track { width: 108px; height: 5px; background: var(--bg); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--v-keep); transition: width 0.25s; }
  .num { font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .signals { font-size: 11px; color: var(--ink-3); }
  .signals b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .who { width: 108px; padding: 5px 8px; font-size: 11.5px; border-radius: 7px; }
  .status { font-size: 11px; color: var(--ink-3); width: 92px; text-align: right; }
  .status[data-s='saved'] { color: var(--v-keep); }
  .status[data-s='error'] { color: var(--v-cut); }
  .btn {
    padding: 6px 11px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--bg);
    border: 1px solid var(--line-2);
    color: var(--ink-2);
    white-space: nowrap;
  }
  .btn:hover { color: var(--ink); border-color: var(--ink-3); }
  .btn.accent { background: var(--accent); border-color: var(--accent); color: #06172c; }
  .btn.accent:hover { filter: brightness(1.1); color: #06172c; }
</style>
