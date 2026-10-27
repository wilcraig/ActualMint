<script>
  import { onMount } from 'svelte';
  import { applyMintTheme, loadSavedMintThemeEnabled, saveMintThemeEnabled } from '../mint-theme';

  // Not restricted to /reports* -- like the text-scale control, this
  // recolors Budget and Transaction pages too, so it mounts on every page.
  let enabled = $state(false);

  onMount(() => {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    enabled = storage ? loadSavedMintThemeEnabled(storage) : false;
    applyMintTheme(document, enabled);
  });

  function toggle() {
    enabled = !enabled;
    applyMintTheme(document, enabled);
    try {
      saveMintThemeEnabled(window.localStorage, enabled);
    } catch {
      // No persistence available -- the theme still applies for this page.
    }
  }
</script>

<button
  type="button"
  class="actualmint-mint-theme-button"
  class:actualmint-mint-theme-button--on={enabled}
  onclick={toggle}
  title="Mint-style theme: {enabled ? 'on' : 'off'} (click to toggle)"
>
  <span class="actualmint-mint-theme-icon">🌿</span>
  <span class="actualmint-mint-theme-label">Mint theme</span>
</button>

<style>
  .actualmint-mint-theme-button {
    position: fixed;
    /* Stacks above the text-scale control (bottom: 4.5rem) on desktop, clear
       of both it and the widget-builder button (bottom: 1rem). */
    bottom: 8rem;
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

  .actualmint-mint-theme-button--on {
    background: #189e74;
    border-color: #0f8762;
  }

  /* Stacks above the text-scale control's mobile position (bottom: 76px,
     left-anchored) instead of the widget-builder button's right-anchored
     one, for the same reason the text-scale control does: the two can
     never collide. */
  @media (max-width: 767px) {
    .actualmint-mint-theme-button {
      bottom: 132px;
      left: 0.5rem;
      right: auto;
    }
  }

  .actualmint-mint-theme-icon {
    font-weight: 700;
  }

  .actualmint-mint-theme-label {
    opacity: 0.8;
  }
</style>
