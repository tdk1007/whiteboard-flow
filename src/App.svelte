<script>
  import { loadBoard, SLUG } from './lib/api.js';
  import Board from './Board.svelte';

  let state = $state({ status: 'loading', board: null, error: null });

  loadBoard()
    .then((board) => {
      document.title = `${board.title} — whiteboard-flow`;
      state = { status: 'ready', board, error: null };
    })
    .catch((e) => {
      state = { status: 'error', board: null, error: String(e.message || e) };
    });
</script>

{#if state.status === 'ready'}
  <Board board={state.board} />
{:else if state.status === 'error'}
  <div class="msg">
    <h1>Couldn't load board “{SLUG}”</h1>
    <pre>{state.error}</pre>
    <p>Boards live in <code>boards/&lt;slug&gt;/board.json</code>. Start the server with <code>./run.sh --slug &lt;slug&gt;</code>.</p>
  </div>
{:else}
  <div class="msg"><p>loading…</p></div>
{/if}

<style>
  .msg {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ink-2);
    padding: 40px;
    text-align: center;
  }
  h1 { font-size: 17px; margin: 0; color: var(--ink); font-weight: 600; }
  pre {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 14px;
    max-width: 640px;
    overflow: auto;
    color: var(--v-cut);
  }
  code { font-family: var(--mono); color: var(--ink); }
  p { margin: 0; font-size: 12px; }
</style>
