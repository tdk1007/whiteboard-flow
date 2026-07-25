<script>
  let { data } = $props();
</script>

<div class="group-node">
  <div class="label">{data.label}</div>
</div>

<style>
  .group-node {
    width: 100%;
    height: 100%;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgba(90, 162, 255, 0.032);
    pointer-events: none;
  }
  .label {
    position: absolute;
    top: 9px;
    left: 14px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
</style>
