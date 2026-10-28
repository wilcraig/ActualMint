<script>
  import { onMount } from 'svelte';
  import { fetchApi } from '../api-client';

  // Each entry: { id, entityType, entityId, targetAmountCents, targetDate,
  // error }. `error` is set per-row when that row's own PUT/DELETE fails, so
  // a failure never clobbers an unrelated row and never pops a page-level
  // toast.
  let goals = $state([]);
  let categories = $state([]);
  let accounts = $state([]);
  let loadErrorMessage = $state(null);
  let loaded = $state(false);

  let carryoverCategories = $derived(categories.filter((c) => c.carryoverEnabled));

  // New-goal form state.
  let newEntityType = $state('category');
  let newEntityId = $state('');
  let newAmountDollars = $state('');
  let newDate = $state('');
  let newGoalError = $state(null);

  function entityOptionsFor(entityType) {
    return entityType === 'category' ? carryoverCategories : accounts;
  }

  function resetNewEntityId() {
    const options = entityOptionsFor(newEntityType);
    newEntityId = options[0]?.id ?? '';
  }

  async function load() {
    loadErrorMessage = null;

    try {
      const [goalsResponse, categoriesResponse, accountsResponse] = await Promise.all([
        fetchApi('/api/goals'),
        fetchApi('/api/categories'),
        fetchApi('/api/accounts'),
      ]);

      if (!goalsResponse.ok) {
        loadErrorMessage = `Goals unavailable (${goalsResponse.status})`;
        return;
      }
      if (!categoriesResponse.ok) {
        loadErrorMessage = `Goals unavailable (${categoriesResponse.status})`;
        return;
      }
      if (!accountsResponse.ok) {
        loadErrorMessage = `Goals unavailable (${accountsResponse.status})`;
        return;
      }

      const goalsBody = await goalsResponse.json();
      const categoriesBody = await categoriesResponse.json();
      const accountsBody = await accountsResponse.json();

      goals = (goalsBody.goals || []).map((goal) => ({ ...goal, error: null }));
      categories = categoriesBody.categories || [];
      accounts = accountsBody.accounts || [];
      resetNewEntityId();
    } catch {
      loadErrorMessage = 'Goals unavailable: could not reach actualmint-api.';
    } finally {
      loaded = true;
    }
  }

  // Re-runs the same initial fetch every time mount-settings.js actually
  // (re)attaches this section next to a found settings anchor -- not just
  // once at bundle load -- so the category picker and goal list refresh
  // whenever the user lands on /settings, including returning to it after
  // navigating away (e.g. after enabling carryover on a category
  // elsewhere in Actual).
  onMount(() => {
    load();
    document.addEventListener('actualmint:settings-attached', load);
    return () => {
      document.removeEventListener('actualmint:settings-attached', load);
    };
  });

  function formatCents(cents) {
    return (cents / 100).toFixed(2);
  }

  function parseDollarsToCents(value) {
    const dollars = Number(value);
    if (!Number.isFinite(dollars)) return null;
    return Math.round(dollars * 100);
  }

  function entityName(entityType, entityId) {
    const list = entityType === 'category' ? categories : accounts;
    const match = list.find((item) => item.id === entityId);
    if (match) return match.name;
    return entityType === 'category' ? '(unknown category)' : '(unknown account)';
  }

  // Shared by saveGoal()'s and addGoal()'s own failure handling: a non-ok
  // response's body is, by convention, `{ error: '<message>' }` (see
  // goals.js's validateGoalBody()/resolve* 400s), but it's still just a
  // best-effort read -- a non-JSON or differently-shaped body falls back to
  // the plain status-based message instead of throwing.
  async function extractErrorMessage(response) {
    let message = `Save failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body -- fall back to the status-based message.
    }
    return message;
  }

  async function saveGoal(goal) {
    goal.error = null;
    try {
      const response = await fetchApi(`/api/goals/${goal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: goal.entityType,
          entityId: goal.entityId,
          targetAmountCents: goal.targetAmountCents,
          targetDate: goal.targetDate,
        }),
      });

      if (!response.ok) {
        goal.error = await extractErrorMessage(response);
        goals = goals.map((g) => (g.id === goal.id ? goal : g));
        return;
      }

      // Only clear this row's error field on whatever the *current* row
      // state is -- never replace the whole row with the `goal` object
      // captured when this save started, which can revert a newer local
      // edit made to the same row while this save was still in flight.
      goals = goals.map((g) => (g.id === goal.id ? { ...g, error: null } : g));
    } catch {
      goal.error = 'Save failed: could not reach actualmint-api.';
      goals = goals.map((g) => (g.id === goal.id ? goal : g));
    }
  }

  // Marks `goal` with an inline error and leaves it in `goals` without
  // calling saveGoal() -- used when the edited value fails client-side
  // validation, same UX as addGoal()'s own guards (inline error, no PUT of
  // the bad value).
  function markInvalid(goal, message) {
    const updated = { ...goal, error: message };
    goals = goals.map((g) => (g.id === goal.id ? updated : g));
  }

  function handleAmountChange(goal, event) {
    const cents = parseDollarsToCents(event.target.value);
    if (cents === null || cents <= 0) {
      markInvalid(goal, 'Enter a target amount greater than zero.');
      return;
    }
    const updated = { ...goal, targetAmountCents: cents };
    goals = goals.map((g) => (g.id === goal.id ? updated : g));
    saveGoal(updated);
  }

  function handleDateChange(goal, event) {
    const value = event.target.value;
    if (!value) {
      markInvalid(goal, 'Choose a target date.');
      return;
    }
    const updated = { ...goal, targetDate: value };
    goals = goals.map((g) => (g.id === goal.id ? updated : g));
    saveGoal(updated);
  }

  async function deleteGoal(goal) {
    goal.error = null;
    try {
      const response = await fetchApi(`/api/goals/${goal.id}`, { method: 'DELETE' });

      if (!response.ok && response.status !== 404) {
        goal.error = `Delete failed (${response.status})`;
        goals = goals.map((g) => (g.id === goal.id ? goal : g));
        return;
      }

      goals = goals.filter((g) => g.id !== goal.id);
    } catch {
      goal.error = 'Delete failed: could not reach actualmint-api.';
      goals = goals.map((g) => (g.id === goal.id ? goal : g));
    }
  }

  function handleNewEntityTypeChange(event) {
    newEntityType = event.target.value;
    resetNewEntityId();
  }

  async function addGoal() {
    newGoalError = null;

    if (!newEntityId) {
      newGoalError = 'Choose a category or account first.';
      return;
    }
    const cents = parseDollarsToCents(newAmountDollars);
    if (cents === null || cents <= 0) {
      newGoalError = 'Enter a target amount greater than zero.';
      return;
    }
    if (!newDate) {
      newGoalError = 'Choose a target date.';
      return;
    }

    const id = crypto.randomUUID();
    const body = {
      entityType: newEntityType,
      entityId: newEntityId,
      targetAmountCents: cents,
      targetDate: newDate,
    };

    try {
      const response = await fetchApi(`/api/goals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        newGoalError = await extractErrorMessage(response);
        return;
      }

      goals = [...goals, { id, ...body, error: null }];
      newAmountDollars = '';
      newDate = '';
    } catch {
      newGoalError = 'Save failed: could not reach actualmint-api.';
    }
  }
</script>

<div class="actualmint-goals-list settings-subgroup">
  <h4 class="group-label">Savings goals</h4>

  {#if loadErrorMessage}
    <p class="goals-load-error" role="alert">{loadErrorMessage}</p>
  {:else if !loaded}
    <p class="goals-loading">Loading goals…</p>
  {:else}
    {#if goals.length === 0}
      <p class="goals-empty">No savings goals yet.</p>
    {:else}
      <ul class="goals-rows">
        {#each goals as goal (goal.id)}
          <li class="goal-row setting-row">
            <span class="goal-entity-name setting-label">{entityName(goal.entityType, goal.entityId)}</span>
            <input
              class="goal-amount-input abt-input"
              type="number"
              step="0.01"
              min="0"
              value={formatCents(goal.targetAmountCents)}
              onchange={(e) => handleAmountChange(goal, e)}
            />
            <input
              class="goal-date-input abt-input"
              type="date"
              value={goal.targetDate}
              onchange={(e) => handleDateChange(goal, e)}
            />
            <button type="button" class="goal-delete-button abt-btn" onclick={() => deleteGoal(goal)}>
              Delete
            </button>
            {#if goal.error}
              <p class="goal-row-error" role="alert">{goal.error}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="goal-new-row setting-row">
      <select
        class="goal-new-type-select abt-input"
        value={newEntityType}
        onchange={handleNewEntityTypeChange}
      >
        <option value="category">Category</option>
        <option value="account">Account</option>
      </select>
      <select
        class="goal-entity-select abt-input"
        value={newEntityId}
        onchange={(e) => { newEntityId = e.target.value; }}
      >
        {#each entityOptionsFor(newEntityType) as option (option.id)}
          <option value={option.id}>{option.name}</option>
        {/each}
      </select>
      <input
        class="goal-new-amount-input abt-input"
        type="number"
        step="0.01"
        min="0"
        placeholder="Amount"
        value={newAmountDollars}
        oninput={(e) => { newAmountDollars = e.target.value; }}
      />
      <input
        class="goal-new-date-input abt-input"
        type="date"
        value={newDate}
        oninput={(e) => { newDate = e.target.value; }}
      />
      <button type="button" class="goal-add-button abt-btn" onclick={addGoal}>Add goal</button>
    </div>
    {#if newGoalError}
      <p class="goal-new-error" role="alert">{newGoalError}</p>
    {/if}
  {/if}
</div>

<style>
  .actualmint-goals-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    margin-top: 0.75rem;
  }

  .goals-load-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .goals-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .goal-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  /* ABT's own base input/button shape (height, radius, subtle
     border/background derived from the inherited text color so it still
     looks right under every Actual theme -- see AccountBalancesChart.svelte's
     colorFor()/labelColorFor() for the same color-mix technique). */
  .abt-input,
  .abt-btn {
    height: 30px;
    border-radius: 6.5px;
    border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    font: inherit;
    font-size: 12px;
    box-sizing: border-box;
  }

  .abt-input {
    padding: 0 8px;
  }

  .abt-btn {
    padding: 0 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .goal-entity-name {
    font-weight: 600;
    min-width: 6rem;
  }

  .goal-amount-input {
    width: 6rem;
  }

  .goal-row-error,
  .goal-new-error {
    color: #b91c1c;
    font-size: 0.85rem;
    margin: 0;
    flex-basis: 100%;
  }

  .goal-new-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
