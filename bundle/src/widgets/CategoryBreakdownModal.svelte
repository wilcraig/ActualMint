<script>
  import { untrack } from 'svelte';
  import { initialState, drillInto, zoomOut, currentMonth, buildBreakdownParams } from './breakdown-nav';
  import { fetchApi } from '../api-client';
  import CategoryBreakdownDonut from './CategoryBreakdownDonut.svelte';

  // Either a single category (categoryId/categoryName/groupId/groupName --
  // the normal PacingBars category-bar entry) OR a rollup (categoryIds/
  // rollupTitle -- a PacingBars rollup-bar entry). See initialState() in
  // breakdown-nav.js for how the two are disambiguated.
  let { categoryId = null, categoryName = null, groupId = null, groupName = null, categoryIds = null, rollupTitle = null, onClose = () => {} } = $props();

  // Caller (PacingBars) mounts one modal instance per opened category/
  // rollup, so these props are only ever read at open time -- intentionally
  // not reactive to later prop changes, hence untrack().
  let nav = $state(
    untrack(() =>
      categoryId != null ? initialState({ categoryId, categoryName, groupId, groupName }) : initialState({ categoryIds, rollupTitle })
    )
  );
  let breakdown = $state(null);
  let errorMessage = $state(null);

  // Request-sequence guard: unlike PacingBars (which fetches once),
  // load() re-fires on every navigation, and the user can trigger a new
  // navigation before a slower in-flight request resolves. Without this,
  // an earlier (slower) request's response arriving after a later
  // (faster) one would overwrite the correct, newer state with stale
  // data. Each load() call claims the next sequence number up front and
  // only applies its result if no newer call has started since.
  let loadSeq = 0;

  async function load(currentNav) {
    const seq = ++loadSeq;
    errorMessage = null;
    breakdown = null;

    try {
      const params = buildBreakdownParams(currentNav, currentMonth());
      const response = await fetchApi(`/api/spending-breakdown?${params}`);

      if (seq !== loadSeq) return; // a newer navigation has since started; discard this response

      if (!response.ok) {
        errorMessage = `Spending breakdown unavailable (${response.status})`;
        return;
      }

      const data = await response.json();
      if (seq !== loadSeq) return; // a newer navigation started while this response body was parsing
      breakdown = data;
    } catch (err) {
      if (seq !== loadSeq) return;
      errorMessage = 'Spending breakdown unavailable: could not reach actualmint-api.';
    }
  }

  // Re-fetch on mount and on every navigation-state transition.
  $effect(() => {
    load(nav);
  });

  function handleSliceClick(sliceId) {
    const slice = breakdown?.slices.find((s) => s.id === sliceId);
    if (!slice) return;
    nav = drillInto(nav, slice);
  }

  function handleBreadcrumbClick(level) {
    while (nav.level !== level && nav.level !== 'groups') {
      nav = zoomOut(nav);
    }
  }

  function handleBack() {
    nav = zoomOut(nav);
  }
</script>

<div class="actualmint-breakdown-modal-backdrop" role="presentation">
  <div class="actualmint-breakdown-modal" role="dialog" aria-modal="true" aria-label="Spending breakdown">
    <div class="breakdown-modal-header">
      <nav class="breakdown-breadcrumb" aria-label="Breakdown level">
        <button
          type="button"
          class="breadcrumb-item"
          class:breadcrumb-current={nav.level === 'groups'}
          onclick={() => handleBreadcrumbClick('groups')}
        >
          Groups
        </button>
        {#if nav.groupName}
          <span class="breadcrumb-sep">/</span>
          <button
            type="button"
            class="breadcrumb-item"
            class:breadcrumb-current={nav.level === 'categories'}
            onclick={() => handleBreadcrumbClick('categories')}
          >
            {nav.groupName}
          </button>
        {/if}
        {#if nav.categoryName}
          <span class="breadcrumb-sep">/</span>
          <button
            type="button"
            class="breadcrumb-item"
            class:breadcrumb-current={nav.level === 'payees'}
            onclick={() => handleBreadcrumbClick('payees')}
          >
            {nav.categoryName}
          </button>
        {/if}
        {#if nav.payeeName}
          <span class="breadcrumb-sep">/</span>
          <button
            type="button"
            class="breadcrumb-item breadcrumb-current"
            onclick={() => handleBreadcrumbClick('transactions')}
          >
            {nav.payeeName}
          </button>
        {/if}
      </nav>
      <button type="button" class="breakdown-close" aria-label="Close" onclick={() => onClose()}>×</button>
    </div>

    <div class="breakdown-modal-body">
      {#if nav.level !== 'groups'}
        <button type="button" class="breakdown-back" onclick={handleBack}>← Back</button>
      {/if}
      {#if errorMessage}
        <p class="breakdown-error" role="alert">{errorMessage}</p>
      {:else if breakdown === null}
        <p class="breakdown-loading">Loading spending breakdown…</p>
      {:else if nav.level === 'transactions'}
        {#if breakdown.transactions.length === 0}
          <p class="breakdown-empty">No transactions.</p>
        {:else}
          <ul class="breakdown-transactions">
            {#each breakdown.transactions as txn (txn.id)}
              <li class="breakdown-transaction">
                <span class="transaction-date">{txn.date}</span>
                <span class="transaction-notes">{txn.notes || txn.importedPayee || ''}</span>
                <span class="transaction-amount">${(txn.amountCents / 100).toFixed(2)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <CategoryBreakdownDonut slices={breakdown.slices} total={breakdown.total} onSliceClick={handleSliceClick} />
      {/if}
    </div>
  </div>
</div>

<style>
  .actualmint-breakdown-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .actualmint-breakdown-modal {
    background: #fff;
    border-radius: 0.5rem;
    padding: 1rem;
    width: 90%;
    max-width: 420px;
    max-height: 85vh;
    overflow-y: auto;
    box-sizing: border-box;
    font-family: inherit;
  }

  .breakdown-modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .breakdown-breadcrumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
  }

  .breadcrumb-item {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #2563eb;
    cursor: pointer;
    text-decoration: underline;
  }

  .breadcrumb-current {
    color: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: default;
  }

  .breadcrumb-sep {
    color: #888;
  }

  .breakdown-close {
    flex: 0 0 auto;
    background: none;
    border: none;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    color: #555;
    padding: 0 0.25rem;
  }

  .breakdown-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .breakdown-empty {
    color: #666;
  }

  .breakdown-back {
    background: none;
    border: none;
    padding: 0;
    margin-bottom: 0.75rem;
    font: inherit;
    font-size: 0.85rem;
    color: #2563eb;
    cursor: pointer;
  }

  .breakdown-transactions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .breakdown-transaction {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.85rem;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.5rem;
  }

  .transaction-date {
    flex: 0 0 auto;
    color: #888;
  }

  .transaction-notes {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transaction-amount {
    flex: 0 0 auto;
    font-weight: 600;
  }
</style>
