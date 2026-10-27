<script>
  import { scaleTime, scaleLinear, line as d3Line, extent as d3Extent, timeFormat } from 'd3';
  import { fetchApi } from '../api-client';

  // An empty array (the default) means "every open account," matching the
  // API's own default when its `accounts` query param is omitted.
  let { accountIds = [] } = $props();

  let range = $state('1M');
  let data = $state(null);
  let errorMessage = $state(null);

  const RANGES = [
    { value: '1M', label: '1M' },
    { value: '3M', label: '3M' },
    { value: '6M', label: '6M' },
    { value: '1Y', label: '1Y' },
    { value: 'all', label: 'All' },
  ];

  // Same deterministic, repeatable fallback palette CategoryBreakdownDonut.svelte
  // established (not brand-specific, not exported from that component, so
  // duplicated here the same way the *-data.js helper functions are
  // duplicated across widgets rather than shared).
  const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  const WIDTH = 640;
  const HEIGHT = 320;
  const MARGIN = { top: 16, right: 16, bottom: 28, left: 64 };

  const formatTick = timeFormat('%b %d');

  // Request-sequence guard, same pattern as CategoryBreakdownModal.svelte:
  // load() re-fires on every range-button click, and the user can switch
  // ranges again before a slower in-flight request resolves.
  let loadSeq = 0;

  async function load(currentRange) {
    const seq = ++loadSeq;
    errorMessage = null;
    data = null;

    try {
      const params = new URLSearchParams({ range: currentRange });
      if (accountIds.length > 0) params.set('accounts', accountIds.join(','));
      const response = await fetchApi(`/api/account-balances?${params}`);
      if (seq !== loadSeq) return; // a newer range selection has since started

      if (!response.ok) {
        errorMessage = `Account balances unavailable (${response.status})`;
        return;
      }

      const body = await response.json();
      if (seq !== loadSeq) return;
      data = body;
    } catch (err) {
      if (seq !== loadSeq) return;
      errorMessage = 'Account balances unavailable: could not reach actualmint-api.';
    }
  }

  // Re-fetch on mount and on every range change.
  $effect(() => {
    load(range);
  });

  // `date` strings are always `YYYY-MM-DD` (api/src/routes/account-balances.js);
  // parsed as local-calendar-day components rather than via `new Date(str)`
  // to avoid that string form's UTC-midnight parsing.
  function parseDateOnly(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  // Every account's series and netWorth are built from the same shared
  // `days` array (see account-balances.js), so a single account having one
  // point (or zero accounts at all) means there is nothing worth plotting --
  // the "brand-new budget" edge case: no transactions yet, so every series
  // collapses to today's single opening-balance point. A one-point (or
  // empty) series can't draw a line, so render a message instead of an
  // empty/zero-size SVG.
  let isEmpty = $derived(!data || data.accounts.length === 0 || data.netWorth.length <= 1);

  let allDates = $derived(data && !isEmpty ? data.netWorth.map((p) => parseDateOnly(p.date)) : []);

  let allBalances = $derived(
    data && !isEmpty
      ? [...data.accounts.flatMap((a) => a.points.map((p) => p.balanceCents)), ...data.netWorth.map((p) => p.balanceCents)]
      : []
  );

  let xScale = $derived.by(() => {
    if (allDates.length === 0) return null;
    return scaleTime()
      .domain(d3Extent(allDates))
      .range([MARGIN.left, WIDTH - MARGIN.right]);
  });

  let yScale = $derived.by(() => {
    if (allBalances.length === 0) return null;
    let [min, max] = d3Extent(allBalances);
    // A perfectly flat combined range (e.g. every account holding a steady
    // zero balance) would otherwise collapse scaleLinear's domain to a
    // single point -- pad it so the line still renders at a sensible height
    // instead of degenerating.
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.1, 100);
      min -= pad;
      max += pad;
    }
    return scaleLinear()
      .domain([min, max])
      .nice()
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);
  });

  let lineGenerator = $derived.by(() => {
    if (!xScale || !yScale) return null;
    return d3Line()
      .x((p) => xScale(parseDateOnly(p.date)))
      .y((p) => yScale(p.balanceCents));
  });

  function pathFor(points) {
    return lineGenerator ? lineGenerator(points) : null;
  }

  let xTicks = $derived(xScale ? xScale.ticks(5) : []);
  let yTicks = $derived(yScale ? yScale.ticks(5) : []);

  function colorFor(index) {
    return COLORS[index % COLORS.length];
  }
</script>

<div class="actualmint-account-balances-chart">
  <!-- Always visible (not gated on load/error state) so a range can be
       picked again -- e.g. to retry -- even while a previous request is
       still loading or failed. -->
  <div class="balances-controls" role="group" aria-label="Date range">
    {#each RANGES as r (r.value)}
      <button
        type="button"
        class="balances-range-button"
        class:balances-range-button--active={range === r.value}
        onclick={() => (range = r.value)}
      >
        {r.label}
      </button>
    {/each}
  </div>

  {#if errorMessage}
    <p class="balances-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="balances-loading">Loading account balances…</p>
  {:else}
    {#if isEmpty}
      <p class="balances-empty">Not enough balance history yet to chart.</p>
    {:else}
      <svg
        class="balances-svg"
        viewBox="0 0 {WIDTH} {HEIGHT}"
        role="img"
        aria-label="Account balances over time"
      >
        {#each yTicks as tick (tick)}
          <line
            class="balances-gridline"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={yScale(tick)}
            y2={yScale(tick)}
          />
          <text class="balances-axis-label balances-axis-label--y" x={MARGIN.left - 8} y={yScale(tick)}>
            {formatCents(tick)}
          </text>
        {/each}

        {#each xTicks as tick (tick.getTime())}
          <text
            class="balances-axis-label balances-axis-label--x"
            x={xScale(tick)}
            y={HEIGHT - MARGIN.bottom + 16}
          >
            {formatTick(tick)}
          </text>
        {/each}

        {#each data.accounts as account, index (account.id)}
          <path class="balances-line" d={pathFor(account.points)} stroke={colorFor(index)} fill="none" />
        {/each}

        <path class="balances-line balances-line--net-worth" d={pathFor(data.netWorth)} fill="none" />
      </svg>

      <ul class="balances-legend">
        {#each data.accounts as account, index (account.id)}
          <li class="balances-legend-item">
            <span class="balances-legend-swatch" style:background={colorFor(index)}></span>
            <span class="balances-legend-label">{account.name}</span>
          </li>
        {/each}
        <li class="balances-legend-item">
          <span class="balances-legend-swatch balances-legend-swatch--net-worth"></span>
          <span class="balances-legend-label">Total</span>
        </li>
      </ul>
    {/if}
  {/if}
</div>

<style>
  .actualmint-account-balances-chart {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context, since it's mounted into a host element of unpredictable
       width inside an Actual report page. */
    container-type: inline-size;
  }

  .balances-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .balances-loading,
  .balances-empty {
    color: #555;
  }

  .balances-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .balances-range-button {
    padding: 0.25rem 0.65rem;
    border: 1px solid #d1d5db;
    border-radius: 999px;
    background: #fff;
    color: #374151;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .balances-range-button--active {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }

  .balances-svg {
    width: 100%;
    height: auto;
  }

  .balances-gridline {
    stroke: #e5e7eb;
    stroke-width: 1;
  }

  .balances-axis-label {
    font-size: 9px;
    fill: #6b7280;
  }

  .balances-axis-label--y {
    text-anchor: end;
    dominant-baseline: middle;
  }

  .balances-axis-label--x {
    text-anchor: middle;
  }

  .balances-line {
    stroke-width: 2;
  }

  /* Visually distinct from every per-account line: thicker, black, and
     dashed, rather than drawn from the shared categorical palette (which is
     reserved for per-account lines and could otherwise collide with one of
     them). */
  .balances-line--net-worth {
    stroke: #111827;
    stroke-width: 3;
    stroke-dasharray: 6 4;
  }

  .balances-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .balances-legend-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
  }

  .balances-legend-swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.15rem;
  }

  .balances-legend-swatch--net-worth {
    background: #111827;
  }
</style>
