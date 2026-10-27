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
    /* Bottom-LEFT collides head-on with Actual's own sidebar footer (Undo/
       Redo/Sync live there too, confirmed by live inspection -- its
       container sits at z-index: 1001, and the buttons themselves occupy
       the same few square inches). Bottom-right, stacked above where the
       widget-builder panel's own floating button sits (bottom: 1rem;
       z-index: 9999), is clear on every page -- the widget-builder button
       only appears on /reports* anyway, so the two are never both present
       at their respective positions without this offset, but stacking
       clear of it still avoids a collision if that ever changes. */
    bottom: 4.5rem;
    right: 1rem;
    z-index: 9999;
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

  /* Actual's own mobile bottom tab bar (Budget/Transaction/Accounts) is a
     fixed, full-width, 70px-tall bar flush with the viewport bottom
     (confirmed by live inspection). Below this width it always shows that
     bar, so move off its right-side stacking position (which overlapped
     "Accounts") and up to just clear it; anchor from the LEFT instead of
     the right so this button can never collide with the widget-builder
     button, which stays right-anchored -- no width coordination needed
     between the two independently-mounted components. */
  @media (max-width: 767px) {
    .actualmint-text-scale-button {
      bottom: 76px;
      left: 0.5rem;
      right: auto;
    }
  }

  .actualmint-text-scale-icon {
    font-weight: 700;
  }

  .actualmint-text-scale-label {
    opacity: 0.8;
  }
</style>
