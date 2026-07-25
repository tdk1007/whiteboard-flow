<script>
  import { getContext } from 'svelte';
  import { VERDICTS, VERDICT_MAP } from '../lib/feedback.svelte.js';

  let { board, selection, onnext, onclear } = $props();

  const review = getContext('review');

  const nodeById = $derived(new Map((board.nodes || []).map((n) => [n.id, n])));

  const answered = $derived(
    (board.questions || []).filter((_, i) => (review.fb.answers[String(i)] || '').trim()).length
  );

  function verdictOf(kind, id) {
    const bucket = kind === 'edge' ? review.fb.edges : review.fb.nodes;
    return (bucket[id] || {}).verdict || null;
  }
  function commentOf(kind, id) {
    const bucket = kind === 'edge' ? review.fb.edges : review.fb.nodes;
    return (bucket[id] || {}).comment || '';
  }
</script>

<aside class="panel">
  {#if selection?.kind === 'node'}
    {@const spec = nodeById.get(selection.id)}
    <header>
      <div class="eyebrow">{spec?.kind || 'component'} · {spec?.group || 'ungrouped'}</div>
      <h2>{spec?.text}</h2>
      {#if spec?.detail}<p class="detail">{spec.detail}</p>{/if}
      {#if spec?.file}<code class="file">{spec.file}</code>{/if}
    </header>

    <section>
      <div class="lbl">Verdict <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd></div>
      <div class="verdicts">
        {#each VERDICTS as v, i}
          <button
            class="v"
            data-hue={v.hue}
            class:on={verdictOf('node', selection.id) === v.key}
            title={v.hint}
            onclick={() => review.setVerdict(selection.id, v.key)}
          >
            <span class="g">{v.glyph}</span>
            <span>{v.label}</span>
          </button>
        {/each}
      </div>
      <p class="hint">{VERDICT_MAP[verdictOf('node', selection.id)]?.hint || 'Pick one, or just leave a comment.'}</p>
    </section>

    <section class="grow">
      <div class="lbl">Comment — this is what steers the work</div>
      <textarea
        rows="7"
        placeholder="e.g. “Do this before the ILT scoring — the SME pass is blocked on path names.”"
        value={commentOf('node', selection.id)}
        oninput={(e) => review.setComment(selection.id, e.currentTarget.value)}
      ></textarea>
    </section>

    <footer>
      <button class="ghost" onclick={onclear}>Deselect <kbd>esc</kbd></button>
      <button class="primary" onclick={onnext}>Next unreviewed <kbd>n</kbd></button>
    </footer>
  {:else if selection?.kind === 'proposed'}
    {@const p = review.fb.proposedNodes.find((n) => n.id === selection.id)}
    <header>
      <div class="eyebrow" style="color: var(--proposed)">proposed by you</div>
      <h2>{p?.text || 'untitled'}</h2>
    </header>
    <section>
      <div class="lbl">Name</div>
      <input value={p?.text || ''} oninput={(e) => review.updateProposedNode(selection.id, { text: e.currentTarget.value })} />
    </section>
    <section class="grow">
      <div class="lbl">What is it / why</div>
      <textarea
        rows="8"
        placeholder="What this piece is and why the plan needs it."
        value={p?.comment || ''}
        oninput={(e) => review.updateProposedNode(selection.id, { comment: e.currentTarget.value })}
      ></textarea>
    </section>
    <footer>
      <button class="ghost danger" onclick={() => { review.removeProposedNode(selection.id); onclear(); }}>Remove</button>
      <button class="primary" onclick={onclear}>Done</button>
    </footer>
  {:else if selection?.kind === 'edge'}
    {@const e = selection.edge}
    <header>
      <div class="eyebrow">connection</div>
      <h2>
        {nodeById.get(e.from)?.text || e.from}
        <span class="arr">→</span>
        {nodeById.get(e.to)?.text || e.to}
      </h2>
      {#if e.text}<p class="detail">labelled “{e.text}”</p>{/if}
      {#if e.proposed}<p class="detail" style="color: var(--proposed)">You drew this connection.</p>{/if}
    </header>

    {#if e.proposed}
      <section class="grow">
        <div class="lbl">Why should these connect?</div>
        <textarea
          rows="8"
          value={review.fb.proposedEdges.find((x) => x.id === e.id)?.comment || ''}
          oninput={(ev) => review.updateProposedEdge(e.id, { comment: ev.currentTarget.value })}
        ></textarea>
      </section>
      <footer>
        <button class="ghost danger" onclick={() => { review.removeProposedEdge(e.id); onclear(); }}>Remove</button>
        <button class="primary" onclick={onclear}>Done</button>
      </footer>
    {:else}
      <section>
        <div class="lbl">Verdict</div>
        <div class="verdicts">
          {#each VERDICTS as v}
            <button
              class="v"
              data-hue={v.hue}
              class:on={verdictOf('edge', e.id) === v.key}
              onclick={() => review.setEdgeVerdict(e.id, v.key)}
            >
              <span class="g">{v.glyph}</span><span>{v.label}</span>
            </button>
          {/each}
        </div>
      </section>
      <section class="grow">
        <div class="lbl">Comment</div>
        <textarea
          rows="7"
          placeholder="e.g. “This shouldn't go direct — it has to route through the write lock.”"
          value={commentOf('edge', e.id)}
          oninput={(ev) => review.setEdgeComment(e.id, ev.currentTarget.value)}
        ></textarea>
      </section>
      <footer>
        <button class="ghost" onclick={onclear}>Deselect <kbd>esc</kbd></button>
      </footer>
    {/if}
  {:else}
    <header>
      <div class="eyebrow">board review</div>
      <h2>{board.title}</h2>
      {#if board.subtitle}<p class="detail">{board.subtitle}</p>{/if}
    </header>

    {#if (board.questions || []).length}
      <section>
        <div class="lbl">
          Open questions
          <span class="count">{answered}/{board.questions.length}</span>
        </div>
        <div class="qs">
          {#each board.questions as q, i}
            <div class="q" class:done={(review.fb.answers[String(i)] || '').trim()}>
              <div class="qt">{q}</div>
              <textarea
                rows="2"
                placeholder="your call…"
                value={review.fb.answers[String(i)] || ''}
                oninput={(e) => review.setAnswer(i, e.currentTarget.value)}
              ></textarea>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="grow">
      <div class="lbl">General direction</div>
      <textarea
        rows="6"
        placeholder="Anything that isn't about one box — scope, sequencing, what you actually care about."
        value={review.fb.general}
        oninput={(e) => review.setGeneral(e.currentTarget.value)}
      ></textarea>
    </section>

    <section class="tips">
      <div class="lbl">How to review</div>
      <ul>
        <li><b>Click a box</b> → verdict + comment. Or hover it and hit the ▲✓✎✕ chips.</li>
        <li><b>Keys</b> <kbd>1</kbd> do-first <kbd>2</kbd> keep <kbd>3</kbd> change <kbd>4</kbd> cut <kbd>n</kbd> next <kbd>esc</kbd> deselect</li>
        <li><b>Double-click empty canvas</b> → propose a new piece of work.</li>
        <li><b>Drag box-edge → box-edge</b> → propose a connection that's missing.</li>
        <li><b>Click a line</b> → say what's wrong with it.</li>
      </ul>
    </section>
  {/if}
</aside>

<style>
  .panel {
    width: 340px;
    flex: none;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 16px 14px;
    background: var(--bg-2);
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }
  header { border-bottom: 1px solid var(--line); padding-bottom: 12px; }
  .eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    color: var(--ink-3);
  }
  h2 {
    margin: 5px 0 0;
    font-size: 16px;
    line-height: 1.25;
    letter-spacing: -0.012em;
    font-weight: 650;
  }
  .arr { color: var(--ink-3); font-weight: 400; }
  .detail { margin: 6px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.45; }
  .file {
    display: inline-block;
    margin-top: 7px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-2);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 1px 6px;
  }
  section { display: flex; flex-direction: column; gap: 7px; }
  section.grow { flex: 1 1 auto; min-height: 110px; }
  section.grow textarea { flex: 1; }
  .lbl {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 700;
    color: var(--ink-3);
  }
  .count { margin-left: auto; font-family: var(--mono); letter-spacing: 0; }

  .verdicts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .v {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--line-2);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 550;
    transition: all 0.1s;
  }
  .v:hover { border-color: var(--ink-3); }
  .v .g { font-size: 11px; }
  .v.on[data-hue='first'] { background: var(--v-first); border-color: var(--v-first); color: #23180a; }
  .v.on[data-hue='keep'] { background: var(--v-keep); border-color: var(--v-keep); color: #082014; }
  .v.on[data-hue='change'] { background: var(--v-change); border-color: var(--v-change); color: #06172c; }
  .v.on[data-hue='cut'] { background: var(--v-cut); border-color: var(--v-cut); color: #2a0810; }
  .hint { margin: 0; font-size: 11px; color: var(--ink-3); line-height: 1.4; }

  .qs { display: flex; flex-direction: column; gap: 10px; }
  .q { border-left: 2px solid var(--line-2); padding-left: 9px; }
  .q.done { border-left-color: var(--v-keep); }
  .qt { font-size: 12px; line-height: 1.4; margin-bottom: 5px; color: var(--ink); }

  .tips ul { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 5px; }
  .tips li { font-size: 11px; line-height: 1.45; color: var(--ink-2); }
  .tips b { color: var(--ink); font-weight: 600; }

  footer { display: flex; gap: 8px; padding-top: 4px; }
  footer button {
    flex: 1;
    padding: 9px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .primary { background: var(--accent); color: #06172c; }
  .primary:hover { filter: brightness(1.1); }
  .ghost { background: var(--bg); border: 1px solid var(--line-2); color: var(--ink-2); }
  .ghost:hover { color: var(--ink); }
  .ghost.danger:hover { color: var(--v-cut); border-color: var(--v-cut); }

  kbd {
    font-family: var(--mono);
    font-size: 9px;
    background: var(--bg-3);
    border: 1px solid var(--line-2);
    border-radius: 4px;
    padding: 1px 4px;
    color: var(--ink-3);
  }
</style>
