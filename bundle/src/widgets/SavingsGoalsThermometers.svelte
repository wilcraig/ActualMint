<script>
  import { fetchApi } from '../api-client';

  // An empty array (the default) means "every category with a goal,"
  // matching the account-balances/spending-breakdown-donut convention of
  // empty/omitted meaning "everything."
  let { categoryIds = [] } = $props();

  let rows = $state(null);
  let errorMessage = $state(null);

  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  // `targetDate` strings are always `YYYY-MM-DD`; parsed as local-calendar-day
  // components rather than via `new Date(str)` to avoid that string form's
  // UTC-midnight parsing (same approach as AccountBalancesChart.svelte).
  function parseDateOnly(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  // Days remaining is computed against the browser's own clock -- there is
  // no server-provided "today" in either /api/goals or /api/budget-pacing
  // for this display-only countdown, so a client Date is unavoidable here.
  function daysRemaining(targetDate) {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = parseDateOnly(targetDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((target - todayMidnight) / msPerDay);
  }

  function daysLabel(days) {
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `${days} days left`;
  }

  // Clamped to [0, 100] and guarded against a zero/invalid target or a
  // balance of any sign/magnitude (e.g. a category whose carryoverEnabled
  // flag changed after its goal was created) -- never NaN, never negative,
  // never over 100.
  function fillPct(balance, targetAmountCents) {
    if (!Number.isFinite(balance) || !Number.isFinite(targetAmountCents)) {
      return 0;
    }
    // A zero (or negative) target means the goal is trivially already met --
    // render it as fully funded rather than as an empty bar.
    if (targetAmountCents <= 0) {
      return 100;
    }
    const pct = (balance / targetAmountCents) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.min(100, Math.max(0, pct));
  }

  async function load() {
    errorMessage = null;
    rows = null;

    try {
      const goalsResponse = await fetchApi('/api/goals');

      if (!goalsResponse.ok) {
        errorMessage = `Savings goals unavailable (${goalsResponse.status})`;
        return;
      }

      const goalsBody = await goalsResponse.json();
      let categoryGoals = (goalsBody.goals || []).filter((goal) => goal.entityType === 'category');

      if (categoryIds.length > 0) {
        const allowed = new Set(categoryIds);
        categoryGoals = categoryGoals.filter((goal) => allowed.has(goal.entityId));
      }

      if (categoryGoals.length === 0) {
        rows = [];
        return;
      }

      const month = currentMonth();
      const params = new URLSearchParams({
        month,
        categories: categoryGoals.map((goal) => goal.entityId).join(','),
      });
      const pacingResponse = await fetchApi(`/api/budget-pacing?${params}`);

      if (!pacingResponse.ok) {
        errorMessage = `Savings goals unavailable (${pacingResponse.status})`;
        return;
      }

      const pacingBody = await pacingResponse.json();
      const categoryById = new Map((pacingBody.categories || []).map((c) => [c.id, c]));

      rows = categoryGoals.map((goal) => {
        // A goal's entityId absent from the budget-pacing response (e.g. the
        // category was deleted) is silently shown as $0 balance, matching
        // budget-pacing.js's own documented "requested id absent -> silently
        // omitted" convention rather than surfacing an error for one row.
        const category = categoryById.get(goal.entityId);
        const balance = category?.balance ?? 0;
        return {
          id: goal.id,
          name: category?.name ?? goal.entityId,
          balance,
          targetAmountCents: goal.targetAmountCents,
          targetDate: goal.targetDate,
          fillPct: fillPct(balance, goal.targetAmountCents),
          daysLeft: daysRemaining(goal.targetDate),
        };
      });
    } catch (err) {
      errorMessage = 'Savings goals unavailable: could not reach insights-api.';
    }
  }

  load();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-savings-goals-thermometers">
  {#if errorMessage}
    <p class="goals-thermo-error" role="alert">{errorMessage}</p>
  {:else if rows === null}
    <p class="goals-thermo-loading">Loading savings goals…</p>
  {:else if rows.length === 0}
    <p class="goals-thermo-empty">No savings goals yet — add one in Settings.</p>
  {:else}
    {#each rows as row (row.id)}
      <div class="goals-thermo-row">
        <div class="goals-thermo-header">
          <span class="goals-thermo-name">{row.name}</span>
          <span class="goals-thermo-amounts">
            {formatCents(row.balance)} / {formatCents(row.targetAmountCents)} by {row.targetDate}
          </span>
        </div>
        <div class="goals-thermo-track">
          <div class="goals-thermo-fill" style:width="{row.fillPct}%"></div>
        </div>
        <p class="goals-thermo-days">{daysLabel(row.daysLeft)}</p>
      </div>
    {/each}
  {/if}
</div>

<style>
  .actualmint-savings-goals-thermometers {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    container-type: inline-size;
  }

  .goals-thermo-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .goals-thermo-loading,
  .goals-thermo-empty {
    color: #555;
  }

  .goals-thermo-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
  }

  .goals-thermo-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .goals-thermo-name {
    font-weight: 600;
  }

  .goals-thermo-amounts {
    color: #555;
  }

  .goals-thermo-track {
    position: relative;
    width: 100%;
    height: 0.9rem;
    background: #e5e7eb;
    border-radius: 0.25rem;
    overflow: hidden;
  }

  .goals-thermo-fill {
    position: absolute;
    inset: 0 auto 0 0;
    height: 100%;
    border-radius: 0.25rem;
    max-width: 100%;
    background: #2563eb;
    transition: width 0.2s ease;
  }

  .goals-thermo-days {
    margin: 0;
    font-size: 0.75rem;
    color: #6b7280;
  }

  @container (max-width: 480px) {
    .goals-thermo-header {
      flex-direction: column;
    }
  }
</style>
