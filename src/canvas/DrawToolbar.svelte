<script>
  import { PEN_COLORS } from '../lib/ink.js';

  let { tool = 'select', color = PEN_COLORS[0].hex, marks = 0, canUndo = false, ontool, oncolor, onundo, onclear } = $props();

  const items = [
    { key: 'select', glyph: '⌖', name: 'Select', sc: 'v', hint: 'Click boxes, pan, drag handles to connect' },
    { key: 'pen', glyph: '✎', name: 'Pen', sc: 'p', hint: 'Freehand — circle it, cross it out, sketch a shape' },
    { key: 'marker', glyph: '▰', name: 'Highlighter', sc: 'h', hint: 'Wide translucent stroke for emphasis' },
    { key: 'text', glyph: 'T', name: 'Text', sc: 't', hint: 'Click anywhere to drop a note' },
    { key: 'box', glyph: '▢', name: 'Box', sc: 'b', hint: 'Drag out your own box — becomes proposed work' },
    { key: 'region', glyph: '⬚', name: 'Region', sc: 'r', hint: 'Ring a whole cluster of boxes' },
    { key: 'arrow', glyph: '↗', name: 'Arrow', sc: 'a', hint: 'Point at something — resolves to box names' },
    { key: 'eraser', glyph: '⌫', name: 'Eraser', sc: 'e', hint: 'Click or drag over markup to remove it' },
  ];

  const drawing = $derived(tool !== 'select' && tool !== 'eraser');
</script>

<div class="toolbar">
  <div class="tools">
    {#each items as t}
      <button
        class="tool"
        class:on={tool === t.key}
        title="{t.name} ({t.sc}) — {t.hint}"
        aria-pressed={tool === t.key}
        onclick={() => ontool?.(t.key)}
      >
        <span class="glyph">{t.glyph}</span>
        <span class="sc">{t.sc}</span>
      </button>
    {/each}
  </div>

  {#if drawing}
    <div class="swatches">
      {#each PEN_COLORS as c}
        <button
          class="swatch"
          class:on={color === c.hex}
          style="--c:{c.hex}"
          title={c.label}
          aria-label={c.label}
          onclick={() => oncolor?.(c.hex)}
        ></button>
      {/each}
    </div>
  {/if}

  {#if marks > 0 || canUndo}
    <div class="acts">
      <button class="act" disabled={!canUndo} title="Undo the last drawing action (⌘Z)" onclick={() => onundo?.()}>undo</button>
      {#if marks > 0}
        <button class="act" title="Remove all {marks} freehand marks" onclick={() => onclear?.()}>clear {marks}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .toolbar {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .tools,
  .swatches,
  .acts {
    display: flex;
    background: color-mix(in srgb, var(--bg-2) 88%, transparent);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .tools {
    flex-direction: column;
  }
  .tool {
    position: relative;
    width: 30px;
    height: 28px;
    border-radius: 6px;
    color: var(--ink-2);
    display: grid;
    place-items: center;
  }
  .tool:hover {
    background: var(--bg-3);
    color: var(--ink);
  }
  .tool.on {
    background: var(--accent);
    color: #06172c;
  }
  .glyph {
    font-size: 14px;
    line-height: 1;
  }
  .sc {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 8px;
    opacity: 0.45;
    text-transform: uppercase;
  }
  .tool.on .sc {
    opacity: 0.6;
  }

  .swatch {
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: var(--c);
    border: 2px solid transparent;
    outline: 1px solid rgba(0, 0, 0, 0.4);
  }
  .swatch.on {
    border-color: var(--ink);
  }

  .acts {
    padding: 3px 4px;
    gap: 6px;
  }
  .act {
    font-size: 10.5px;
    color: var(--ink-3);
    padding: 1px 3px;
  }
  .act:hover:not(:disabled) {
    color: var(--ink);
  }
  .act:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
