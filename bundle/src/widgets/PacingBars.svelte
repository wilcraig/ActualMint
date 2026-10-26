<script>
  import { computeBarState } from './pacing-data';
  import { fetchApi } from '../api-client';
  import CategoryBreakdownModal from './CategoryBreakdownModal.svelte';

  let { categoryIds = [] } = $props();

  let categories = $state(null);
  let errorMessage = $state(null);
  let openCategory = $state(null);

  function openBreakdown(category) {
    openCategory = {
      categoryId: category.id,
      categoryName: category.name,
      groupId: category.groupId,
      groupName: category.groupName,
    };
  }

  function closeBreakdown() {
    openCategory = null;
  }

  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async function load() {
    errorMessage = null;
    categories = null;

    try {
      const month = currentMonth();
      const params = new URLSearchParams({ month, categories: categoryIds.join(',') });
      const response = await fetchApi(`/api/budget-pacing?${params}`);

      if (!response.ok) {
        errorMessage = `Pacing data unavailable (${response.status})`;
        return;
      }

      const data = await response.json();
      categories = data.categories.map((category) => ({
        ...category,
        bar: computeBarState(
          { budgeted: category.budgeted, spent: category.spent },
          { daysElapsed: data.daysElapsed, daysInMonth: data.daysInMonth },
        ),
      }));
    } catch (err) {
      errorMessage = 'Pacing data unavailable: could not reach actualmint-api.';
    }
  }

  load();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-pacing-bars">
  {#if errorMessage}
    <p class="pacing-error" role="alert">{errorMessage}</p>
  {:else if categories === null}
    <p class="pacing-loading">Loading budget pacing…</p>
  {:else if categories.length === 0}
    <p class="pacing-empty">No pacing categories to show.</p>
  {:else}
    {#each categories as category (category.id)}
      <button type="button" class="pacing-row" onclick={() => openBreakdown(category)}>
        <div class="pacing-row-header">
          <span class="pacing-name">{category.name}</span>
          <span class="pacing-amounts">
            {formatCents(category.spent)} / {formatCents(category.budgeted)}
          </span>
        </div>
        <div class="pacing-track">
          <div
            class="pacing-fill pacing-fill--{category.bar.status}"
            style:width="{category.bar.fillPct}%"
          ></div>
          <div class="pacing-tick" style:left="{category.bar.tickPct}%"></div>
        </div>
      </button>
    {/each}
  {/if}

  {#if openCategory}
    <CategoryBreakdownModal
      categoryId={openCategory.categoryId}
      categoryName={openCategory.categoryName}
      groupId={openCategory.groupId}
      groupName={openCategory.groupName}
      onClose={closeBreakdown}
    />
  {/if}
</div>

<style>
  .actualmint-pacing-bars {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context for the @container query below, since it's mounted into a
       host element of unpredictable width inside an Actual report page. */
    container-type: inline-size;
  }

  .pacing-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .pacing-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    /* Reset <button> defaults so this keeps looking like the plain row it
       was before becoming keyboard-accessible (button semantics). */
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  .pacing-row-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .pacing-name {
    font-weight: 600;
  }

  .pacing-amounts {
    color: #555;
  }

  .pacing-track {
    position: relative;
    width: 100%;
    height: 0.9rem;
    background: #e5e7eb;
    border-radius: 0.25rem;
    overflow: visible;
  }

  .pacing-fill {
    position: absolute;
    inset: 0 auto 0 0;
    height: 100%;
    border-radius: 0.25rem;
    max-width: 100%;
    transition: width 0.2s ease;
  }

  .pacing-fill--under {
    background: #22c55e;
  }

  .pacing-fill--near {
    background: #f59e0b;
  }

  .pacing-fill--over {
    background: #ef4444;
  }

  .pacing-tick {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: #000;
    transform: translateX(-1px);
  }

  /* Narrow (phone-width) containers: stack amounts under the category
     name instead of letting them squeeze onto one tight line. */
  @container (max-width: 480px) {
    .pacing-row-header {
      flex-direction: column;
    }
  }
</style>
