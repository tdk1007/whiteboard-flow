<script>
  import { PEN_COLORS } from '../lib/ink.js';

  let { tool = 'select', color = PEN_COLORS[0].hex, marks = 0, canUndo = false, ontool, oncolor, onundo, onclear } = $props();

  const items = [
    { key: 'select', glyph: '⌖', name: 'Select', sc: 'v', hint: 'Click boxes, drag them, drag handles to connect' },
    // Drawn rather than typed: every hand character has an emoji presentation by
    // default, and one colour glyph in a row of monochrome ones reads as a bug.
    {
      key: 'pan',
      name: 'Pan',
      sc: 'h',
      hint: 'Drag anywhere to move the board — nothing else moves',
      svg: 'M6.1 8.2V3.7a1 1 0 0 1 2 0v3.4M8.1 7.1V3.2a1 1 0 0 1 2 0v3.9M10.1 7.4V4.9a1 1 0 0 1 2 0v4.7c0 2.6-1.7 4.3-4.1 4.3-2.3 0-4-1.4-4-3.5V8.3a1 1 0 0 1 2 0v1.5',
    },
    { key: 'pen', glyph: '✎', name: 'Pen', sc: 'p', hint: 'Freehand — circle it, cross it out, sketch a shape' },
    { key: 'marker', glyph: '▰', name: 'Highlighter', sc: 'm', hint: 'Wide translucent stroke for emphasis' },
    { key: 'text', glyph: 'T', name: 'Text', sc: 't', hint: 'Click anywhere to drop a note' },
    { key: 'box', glyph: '▢', name: 'Box', sc: 'b', hint: 'Drag out your own box — becomes proposed work' },
    { key: 'region', glyph: '⬚', name: 'Region', sc: 'r', hint: 'Ring a whole cluster of boxes' },
    { key: 'arrow', glyph: '↗', name: 'Arrow', sc: 'a', hint: 'Point at something — resolves to box names' },
    { key: 'eraser', glyph: '⌫', name: 'Eraser', sc: 'e', hint: 'Click or drag over markup to remove it' },
  ];

  // swatches only mean something for tools that put ink down
  const drawing = $derived(tool !== 'select' && tool !== 'pan' && tool !== 'eraser');
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
        {#if t.svg}
          <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d={t.svg} />
          </svg>
        {:else}
          <span class="glyph">{t.glyph}</span>
        {/if}
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
  .icon {
    width: 15px;
    height: 15px;
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
