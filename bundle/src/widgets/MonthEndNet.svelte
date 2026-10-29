<script>
  import { netSignClass } from './month-end-net-data';
  import { fetchApi } from '../api-client';

  let data = $state(null);
  let errorMessage = $state(null);

  // Duplicated from PacingBars.svelte rather than extracted to a shared
  // module: it's a 5-line function with one call site per widget, and
  // PacingBars.svelte itself keeps its own copy rather than extracting it,
  // so this follows that same established precedent.
  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async function load() {
    errorMessage = null;
    data = null;

    try {
      const month = currentMonth();
      const response = await fetchApi(`/api/month-end-projection?month=${month}`);

      if (!response.ok) {
        errorMessage = `Month-end projection unavailable (${response.status})`;
        return;
      }

      data = await response.json();
    } catch (err) {
      errorMessage = 'Month-end projection unavailable: could not reach insights-api.';
    }
  }

  load();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-month-end-net">
  {#if errorMessage}
    <p class="month-end-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="month-end-loading">Loading month-end projection…</p>
  {:else}
    <p class="month-end-figure month-end-figure--{netSignClass(data.projectedNetCents)}">
      {formatCents(data.projectedNetCents)}
    </p>
    <details class="month-end-details">
      <summary>Breakdown</summary>
      <dl class="month-end-components">
        <dt>Income so far</dt>
        <dd>{formatCents(data.components.incomeSoFarCents)}</dd>
        <dt>Remaining scheduled income</dt>
        <dd>{formatCents(data.components.remainingScheduledIncomeCents)}</dd>
        <dt>Spent so far</dt>
        <dd>{formatCents(data.components.spentSoFarCents)}</dd>
        <dt>Trended remaining spending</dt>
        <dd>{formatCents(data.components.trendedRemainingSpendingCents)}</dd>
      </dl>
    </details>
  {/if}
</div>

<style>
  .actualmint-month-end-net {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context, since it's mounted into a host element of unpredictable
       width inside an Actual report page. */
    container-type: inline-size;
  }

  .month-end-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .month-end-figure {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .month-end-figure--positive {
    color: #22c55e;
  }

  .month-end-figure--negative {
    color: #ef4444;
  }

  .month-end-details {
    font-size: 0.85rem;
  }

  .month-end-details summary {
    cursor: pointer;
    color: #555;
  }

  .month-end-components {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0 0;
  }

  .month-end-components dt {
    color: #555;
  }

  .month-end-components dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  @container (max-width: 320px) {
    .month-end-components {
      grid-template-columns: 1fr;
    }

    .month-end-components dd {
      text-align: left;
      margin-bottom: 0.25rem;
    }
  }
</style>
