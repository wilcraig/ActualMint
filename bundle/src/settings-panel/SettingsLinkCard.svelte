<script>
  import { navigateToInsights } from '../insights-page/route';

  // What's left of the old "Actual Insights" settings card on Actual's
  // Settings page once its controls moved to the Insights page: a
  // signpost, so anyone who remembers the old place still finds the new
  // one. mount-settings.js places it and matches the native card chrome.
  function openInsights() {
    navigateToInsights(window);
  }
</script>

<div class="actualmint-settings-link-card">
  <span class="link-card-text">
    <h3 class="section-title">Actual Insights</h3>
    <span class="link-card-desc">
      Settings, savings goals, summaries and notification channels now live on the Insights page.
    </span>
  </span>
  <button type="button" class="link-card-button" onclick={openInsights}>Open Insights</button>
</div>

<style>
  .actualmint-settings-link-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
  }

  .link-card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .link-card-desc {
    font-size: 12px;
    opacity: 0.65;
  }

  /* Same accent pill as the Insights page's selected tab, so the two
     read as one feature. Colors relative to the theme, never literal. */
  .link-card-button {
    flex-shrink: 0;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--palette-chartQual1, #2563eb);
    background: color-mix(in srgb, var(--palette-chartQual1, #2563eb) 20%, transparent);
    color: var(--palette-chartQual1, #2563eb);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .link-card-button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
</style>
