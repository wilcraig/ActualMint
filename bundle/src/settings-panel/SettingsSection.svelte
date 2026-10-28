<script>
  import { onMount } from 'svelte';
  import { PRESETS, loadSavedScale, saveScale, applyScale } from '../text-scale';
  import { applyMintTheme, loadSavedMintThemeEnabled, saveMintThemeEnabled } from '../mint-theme';
  import GoalsList from './GoalsList.svelte';

  let currentPx = $state(PRESETS[0].px);
  let mintEnabled = $state(false);
  // Local-only (not persisted, per the task's own card layout) -- defaults
  // to expanded so the settings this card already showed stay visible
  // without the user needing to discover a new toggle.
  let expanded = $state(true);

  onMount(() => {
    let storage;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    currentPx = storage ? loadSavedScale(storage) : PRESETS[0].px;
    mintEnabled = storage ? loadSavedMintThemeEnabled(storage) : false;
    // index.js already applies both on every page load; re-applying here
    // too is harmless (both are idempotent) and keeps this section
    // self-contained if it's ever reused outside index.js's load order.
    applyScale(document, currentPx);
    applyMintTheme(document, mintEnabled);
  });

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleTextSizeChange(event) {
    const px = Number(event.target.value);
    currentPx = px;
    applyScale(document, px);
    try {
      saveScale(window.localStorage, px);
    } catch {
      // No persistence available -- the size still applies for this page.
    }
  }

  function handleMintToggle(event) {
    mintEnabled = event.target.checked;
    applyMintTheme(document, mintEnabled);
    try {
      saveMintThemeEnabled(window.localStorage, mintEnabled);
    } catch {
      // No persistence available -- the theme still applies for this page.
    }
  }
</script>

<div class="actualmint-settings-section settings-section">
  <button
    type="button"
    class="section-toggle"
    aria-expanded={expanded ? 'true' : 'false'}
    onclick={toggleExpanded}
  >
    <h3 class="section-title">ActualMint</h3>
    <svg
      class="chevron"
      class:chevron-expanded={expanded}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  {#if expanded}
    <div class="settings-list">
      <div class="setting-row">
        <span class="setting-text">
          <span class="setting-label">
            <label for="actualmint-text-size-select">Text size</label>
          </span>
          <span class="setting-desc">Make ActualMint's own widgets larger or smaller.</span>
        </span>
        <select
          id="actualmint-text-size-select"
          value={currentPx}
          onchange={handleTextSizeChange}
        >
          {#each PRESETS as preset (preset.id)}
            <option value={preset.px}>{preset.label}</option>
          {/each}
        </select>
      </div>

      <div class="setting-row">
        <span class="setting-text">
          <span class="setting-label">Mint-style theme</span>
          <span class="setting-desc">Recolor Actual to look more like a classic budgeting app.</span>
        </span>
        <label class="setting-toggle">
          <input type="checkbox" checked={mintEnabled} onchange={handleMintToggle} />
        </label>
      </div>

      <GoalsList />
    </div>
  {/if}
</div>

<style>
  .actualmint-settings-section {
    display: flex;
    flex-direction: column;
  }

  /* Shared settings-section visual conventions (card, toggle header, row
     layout, label/description typography) are declared :global() here so
     GoalsList.svelte -- rendered as a child -- can use the same class
     names on its own markup and visually match, without a shared
     stylesheet import (Svelte's per-component scoped CSS otherwise has no
     clean way to share classes across component boundaries). Colors are
     always currentColor/inherit/relative-opacity, never literal, so this
     still looks right under every Actual theme (see mount-settings.js's
     own comments on why, which apply equally here). */
  :global(.settings-section) {
    border: 1px solid currentColor;
    border-radius: 6.5px;
  }

  :global(.settings-section .section-toggle) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  :global(.settings-section .section-title) {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  :global(.settings-section .chevron) {
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  :global(.settings-section .chevron.chevron-expanded) {
    transform: rotate(180deg);
  }

  :global(.settings-section .settings-list) {
    display: flex;
    flex-direction: column;
    padding: 0 16px 12px;
  }

  :global(.settings-section .settings-subgroup) {
    display: flex;
    flex-direction: column;
  }

  :global(.settings-section .group-label) {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  :global(.settings-section .setting-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 0;
  }

  :global(.settings-section .setting-text) {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :global(.settings-section .setting-label) {
    font-size: 13px;
    font-weight: 500;
  }

  :global(.settings-section .setting-desc) {
    font-size: 11px;
    opacity: 0.65;
  }

  :global(.settings-section .setting-toggle) {
    display: flex;
    align-items: center;
    cursor: pointer;
  }
</style>
