<script>
  import { fetchApi } from '../api-client';

  let data = $state(null);
  let errorMessage = $state(null);

  async function load() {
    errorMessage = null;
    data = null;

    try {
      const response = await fetchApi('/api/unlinked-transfers');

      if (!response.ok) {
        errorMessage = `Unlinked transfers unavailable (${response.status})`;
        return;
      }

      data = await response.json();
    } catch (err) {
      errorMessage = 'Unlinked transfers unavailable: could not reach insights-api.';
    }
  }

  load();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${month}/${day}/${year.slice(2)}`;
  }
</script>

<div class="actualmint-unlinked-transfers">
  {#if errorMessage}
    <p class="unlinked-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="unlinked-loading">Checking for unlinked transfers…</p>
  {:else if data.candidates.length === 0}
    <p class="unlinked-clean">No unlinked transfer pairs found in the last 180 days.</p>
  {:else}
    <p class="unlinked-summary">
      {data.candidates.length}
      {data.candidates.length === 1 ? 'pair' : 'pairs'} likely counted twice in Income/Expenses
      (opposite amounts, different accounts, a few days apart, never linked as a transfer).
    </p>
    <ul class="unlinked-list">
      {#each data.candidates as pair}
        <li class="unlinked-item">
          <span class="unlinked-amount">{formatCents(pair.amountCents)}</span>
          <span class="unlinked-route">
            {pair.first.accountName} ({formatDate(pair.first.date)}) &rarr;
            {pair.second.accountName} ({formatDate(pair.second.date)})
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .actualmint-unlinked-transfers {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    container-type: inline-size;
  }

  .unlinked-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .unlinked-clean {
    color: #22c55e;
    font-weight: 600;
  }

  .unlinked-summary {
    margin: 0 0 0.25rem;
    font-weight: 600;
    color: #b45309;
  }

  .unlinked-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .unlinked-item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .unlinked-amount {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .unlinked-route {
    color: #555;
  }

  @container (max-width: 320px) {
    .unlinked-item {
      flex-direction: column;
      gap: 0.1rem;
    }
  }
</style>
