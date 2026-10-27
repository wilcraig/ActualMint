<script>
  import { onMount } from 'svelte';
  import { PRESETS, loadSavedScale, saveScale, applyScale, nextPreset } from '../text-scale';

  // Unlike the widget-builder panel, this control is NOT restricted to
  // /reports* -- the user asked for bigger text on budgets too, and Actual's
  // Budget page is a different route entirely.
  let currentPx = $state(PRESETS[0].px);
  let currentPreset = $derived(
    PRESETS.find((p) => p.px === currentPx) ?? nextPreset(currentPx - 1),
  );

  onMount(() => {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const saved = storage ? loadSavedScale(storage) : PRESETS[0].px;
    currentPx = saved;
    applyScale(document, saved);
  });

  function cycle() {
    const next = nextPreset(currentPx);
    currentPx = next.px;
    applyScale(document, next.px);
    try {
      saveScale(window.localStorage, next.px);
    } catch {
      // No persistence available -- the size still applies for this page.
    }
  }
</script>

<button
  type="button"
  class="actualmint-text-scale-button"
  onclick={cycle}
  title="Text size: {currentPreset.label} (click to change)"
>
  <span class="actualmint-text-scale-icon">Aa</span>
  <span class="actualmint-text-scale-label">{currentPreset.label}</span>
</button>

<style>
  .actualmint-text-scale-button {
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    z-index: 999;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #1f2430;
    color: #fff;
    border: 1px solid #3c4254;
    border-radius: 999px;
    padding: 0.5rem 0.9rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .actualmint-text-scale-icon {
    font-weight: 700;
  }

  .actualmint-text-scale-label {
    opacity: 0.8;
  }
</style>
