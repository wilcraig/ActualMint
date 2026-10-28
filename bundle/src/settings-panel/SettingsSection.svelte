<script>
  import { onMount } from 'svelte';
  import { PRESETS, loadSavedScale, saveScale, applyScale } from '../text-scale';
  import { applyMintTheme, loadSavedMintThemeEnabled, saveMintThemeEnabled } from '../mint-theme';
  import GoalsList from './GoalsList.svelte';

  let currentPx = $state(PRESETS[0].px);
  let mintEnabled = $state(false);

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

<div class="actualmint-settings-section">
  <strong>ActualMint</strong>
  <span>A few extra personal touches, on top of Actual itself.</span>
</div>

<div class="actualmint-settings-row">
  <label for="actualmint-text-size-select">Text size</label>
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

<div class="actualmint-settings-row">
  <label>
    <input type="checkbox" checked={mintEnabled} onchange={handleMintToggle} />
    Mint-style theme
  </label>
</div>

<GoalsList />

<style>
  .actualmint-settings-section {
    display: flex;
    flex-direction: column;
    margin-bottom: 0.75rem;
  }

  .actualmint-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .actualmint-settings-row label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
</style>
