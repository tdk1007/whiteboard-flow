<script>
  import { Handle, Position } from '@xyflow/svelte';
  import { getContext, untrack } from 'svelte';

  let { id, data, selected } = $props();

  const review = getContext('review');
  // read through to the store, not the snapshot baked into `data` at add time,
  // so renaming from the panel updates the box on the canvas too
  const spec = $derived(review.fb.proposedNodes.find((n) => n.id === id) || data.spec);

  let editing = $state(!!untrack(() => data.spec).__fresh);
  let el = $state(null);

  // Focus has to survive Svelte Flow's own mount/measure pass, otherwise the
  // reviewer's first keystrokes fall through to the board's shortcut handler.
  $effect(() => {
    if (!editing || !el) return;
    const node = el;
    node.focus();
    node.select();
    const t = setTimeout(() => {
      if (document.activeElement !== node) {
        node.focus();
        node.select();
      }
    }, 60);
    return () => clearTimeout(t);
  });

  function commit(text) {
    const t = text.trim();
    editing = false;
    if (!t) {
      review.removeProposedNode(id);
      return;
    }
    review.updateProposedNode(id, { text: t, __fresh: undefined });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="proposed-node" class:selected role="group" ondblclick={() => (editing = true)}>
  <Handle type="target" position={Position.Left} id="l" />
  <Handle type="target" position={Position.Top} id="t" />

  <div class="tag">proposed</div>
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={el}
      class="edit"
      value={spec.text}
      onblur={(e) => commit(e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = spec.text;
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  {:else}
    <div class="title">{spec.text || 'untitled'}</div>
  {/if}
  {#if (spec.comment || '').trim()}
    <div class="note">{spec.comment}</div>
  {/if}

  <button class="del" title="Remove this proposal" onclick={(e) => { e.stopPropagation(); review.removeProposedNode(id); }}>✕</button>

  <Handle type="source" position={Position.Right} id="r" />
  <Handle type="source" position={Position.Bottom} id="b" />
</div>

<style>
  .proposed-node {
    position: relative;
    width: max-content;
    max-width: 220px;
    min-width: 130px;
    padding: 8px 11px 9px;
    background: color-mix(in srgb, var(--proposed) 12%, var(--bg-2));
    border: 1px dashed var(--proposed);
    border-radius: var(--radius);
  }
  .proposed-node.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--proposed) 45%, transparent); }
  .tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 700;
    color: var(--proposed);
    margin-bottom: 3px;
  }
  .title { font-weight: 600; font-size: 12.5px; line-height: 1.25; }
  .note { margin-top: 4px; font-size: 11px; color: var(--ink-2); line-height: 1.35; }
  .edit { padding: 3px 6px; font-size: 12.5px; font-weight: 600; }
  .del {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-3);
    border: 1px solid var(--line-2);
    color: var(--ink-3);
    font-size: 9px;
    line-height: 1;
    display: none;
  }
  .proposed-node:hover .del { display: block; }
  .del:hover { color: var(--v-cut); border-color: var(--v-cut); }
</style>
