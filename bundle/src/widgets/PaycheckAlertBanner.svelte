<script>
  import { fetchApi } from '../api-client';

  let alerts = $state(null);
  let errorMessage = $state(null);

  // Duplicated from PacingBars.svelte/MonthEndNet.svelte rather than
  // extracted to a shared module: both of those widgets already keep their
  // own copy of this 5-line function rather than sharing one, so this
  // follows that same established precedent.
  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async function load() {
    errorMessage = null;
    alerts = null;

    try {
      const response = await fetchApi('/api/paycheck-alerts');

      if (!response.ok) {
        errorMessage = `Paycheck alerts unavailable (${response.status})`;
        return;
      }

      const data = await response.json();
      alerts = data.alerts;
    } catch (err) {
      errorMessage = 'Paycheck alerts unavailable: could not reach actualmint-api.';
    }
  }

  load();

  function whenLabel(alert) {
    return alert.month === currentMonth() ? 'this month' : 'next month';
  }
</script>

<div class="actualmint-paycheck-alert-banner">
  {#if errorMessage}
    <p class="paycheck-alert-error" role="alert">{errorMessage}</p>
  {:else if alerts === null}
    <p class="paycheck-alert-loading">Loading paycheck alerts…</p>
  {:else if alerts.length > 0}
    {#each alerts as alert (`${alert.scheduleId}-${alert.month}`)}
      <p class="paycheck-alert-row">
        {alert.occurrences} {alert.scheduleName} paychecks {whenLabel(alert)} (~{alert.averagePerMonth.toFixed(
          1,
        )}/month average)
      </p>
    {/each}
  {/if}
</div>

<style>
  .actualmint-paycheck-alert-banner {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }

  .paycheck-alert-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .paycheck-alert-row {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #b45309;
  }
</style>
