<script>
  // Stand-in for the Summaries and Channels tabs until the plans that
  // build them replace these entries in tabs.js.
  let { label = '' } = $props();
</script>

<div class="actualmint-placeholder-tab settings-section">
  <div class="section-header">
    <h3 class="section-title">{label}</h3>
  </div>
  <p class="placeholder-text">Coming in a later update.</p>
</div>

<style>
  .placeholder-text {
    margin: 0;
    padding: 0 16px 16px;
    font-size: 13px;
    opacity: 0.65;
  }
</style>
