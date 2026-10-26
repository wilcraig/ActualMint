<script>
  import { fetchApi } from '../api-client';

  let items = $state(null);
  let errorMessage = $state(null);

  // Duplicated from PacingBars.svelte / MonthEndNet.svelte rather than
  // extracted to a shared module -- same established precedent: a 5-line
  // function with one call site per widget, each widget keeps its own copy.
  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async function load() {
    errorMessage = null;
    items = null;

    try {
      const month = currentMonth();
      const response = await fetchApi(`/api/bills-timeline?month=${month}`);

      if (!response.ok) {
        errorMessage = `Bills timeline unavailable (${response.status})`;
        return;
      }

      const data = await response.json();
      items = data.items;
    } catch (err) {
      errorMessage = 'Bills timeline unavailable: could not reach actualmint-api.';
    }
  }

  load();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-bills-timeline">
  {#if errorMessage}
    <p class="bills-timeline-error" role="alert">{errorMessage}</p>
  {:else if items === null}
    <p class="bills-timeline-loading">Loading bills timeline…</p>
  {:else if items.length === 0}
    <p class="bills-timeline-empty">Nothing upcoming this month.</p>
  {:else}
    <ul class="bills-timeline-list">
      {#each items as item, i (item.scheduleId + item.date + i)}
        <li class="bills-timeline-row">
          <span class="bills-timeline-date">{item.date}</span>
          <span class="bills-timeline-payee">{item.payeeName}</span>
          <span class="bills-timeline-amount">{formatCents(item.amountCents)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .actualmint-bills-timeline {
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

  .bills-timeline-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .bills-timeline-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bills-timeline-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .bills-timeline-date {
    color: #555;
    flex: 0 0 auto;
  }

  .bills-timeline-payee {
    flex: 1 1 auto;
    font-weight: 600;
  }

  .bills-timeline-amount {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  @container (max-width: 320px) {
    .bills-timeline-row {
      flex-direction: column;
      gap: 0.15rem;
    }
  }
</style>
