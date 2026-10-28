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

  function selectTextSize(px) {
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
          <span class="setting-label" id="actualmint-text-size-label">Text size</span>
          <span class="setting-desc">Make ActualMint's own widgets larger or smaller.</span>
        </span>
        <span class="pill-group" role="group" aria-labelledby="actualmint-text-size-label">
          {#each PRESETS as preset (preset.id)}
            <button
              type="button"
              id="actualmint-text-size-pill-{preset.id}"
              class="pill"
              class:pill--active={currentPx === preset.px}
              aria-pressed={currentPx === preset.px ? 'true' : 'false'}
              onclick={() => selectTextSize(preset.px)}
            >
              {preset.label}
            </button>
          {/each}
        </span>
      </div>

      <div class="setting-row">
        <span class="setting-text">
          <span class="setting-label">Mint-style theme</span>
          <span class="setting-desc">Recolor Actual to look more like a classic budgeting app.</span>
        </span>
        <label class="setting-toggle switch">
          <input
            type="checkbox"
            class="switch__input"
            checked={mintEnabled}
            onchange={handleMintToggle}
          />
          <span class="switch__track"><span class="switch__thumb"></span></span>
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

  /* CSS-only toggle switch, matching ABT's own `.switch`/`.switch__track`/
     `.switch__thumb` shape. The real checkbox input stays present and
     functional (same checked/onchange wiring) -- only visually hidden --
     so this keeps full keyboard/screen-reader semantics rather than
     swapping in an unlabeled <div>. Colors are relative to currentColor so
     this renders correctly in every Actual theme. */
  :global(.settings-section .switch) {
    width: 28px;
    height: 16px;
    position: relative;
    display: flex;
    flex-shrink: 0;
  }

  :global(.settings-section .switch__input) {
    position: absolute;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  :global(.settings-section .switch__track) {
    width: 28px;
    height: 16px;
    border-radius: 999px;
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, currentColor 20%, transparent);
    transition: background-color 0.15s ease;
    pointer-events: none;
  }

  :global(.settings-section .switch__input:checked + .switch__track) {
    background: var(--palette-chartQual1, #2563eb);
  }

  :global(.settings-section .switch__thumb) {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: Canvas;
    position: absolute;
    left: 2px;
    top: 2px;
    transition: transform 0.15s ease;
  }

  :global(.settings-section .switch__input:checked + .switch__track .switch__thumb) {
    transform: translateX(12px);
  }

  :global(.settings-section .switch__input:focus-visible + .switch__track) {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  /* Pill-button group, matching ABT's own segmented-control chips. */
  :global(.settings-section .pill-group) {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  :global(.settings-section .pill) {
    height: 24px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  :global(.settings-section .pill--active) {
    background: color-mix(in srgb, var(--palette-chartQual1, #2563eb) 20%, transparent);
    border-color: var(--palette-chartQual1, #2563eb);
    color: var(--palette-chartQual1, #2563eb);
  }
</style>
