<script>
  import { arc as d3Arc } from 'd3';
  import { computeSlices } from './donut-data';

  // showLegend=false is for the standalone main-reports-page donut (see
  // SpendingBreakdownDonut.svelte): no always-visible legend list, slice
  // identity is discovered instead via hover (desktop) or long-press
  // (touch), which shows that slice's label and amount in the donut's own
  // hollow center. The PacingBars drill-down modal keeps the legend
  // (showLegend's default, unchanged).
  let { slices = [], total = 0, onSliceClick = () => {}, showLegend = true } = $props();

  const SIZE = 200;
  const RADIUS = SIZE / 2;
  const INNER_RADIUS = RADIUS * 0.6;

  const arcGenerator = d3Arc().innerRadius(INNER_RADIUS).outerRadius(RADIUS);

  // The one slice currently hovered or long-pressed, by id -- null means
  // nothing is active and the center stays blank. Tracked by id rather than
  // the slice object itself so it survives a re-derive of `computed` (e.g.
  // after a drill-down's data reloads) without going stale.
  let hoveredId = $state(null);
  let longPressTimer = null;
  const LONG_PRESS_MS = 400;

  function handleTouchStart(id) {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      hoveredId = id;
    }, LONG_PRESS_MS);
  }

  function handleTouchEnd() {
    clearTimeout(longPressTimer);
    hoveredId = null;
  }

  // Deterministic, repeatable fallback palette (not brand-specific) so
  // slices stay visually distinct without depending on category data
  // carrying its own color.
  const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  let computed = $derived(computeSlices(slices));
  let hoveredSlice = $derived(computed.find((s) => s.id === hoveredId) ?? null);

  function colorFor(index) {
    return COLORS[index % COLORS.length];
  }

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  function pathFor(slice) {
    return arcGenerator({ startAngle: slice.startAngle, endAngle: slice.endAngle });
  }
</script>

<div class="actualmint-category-breakdown-donut">
  {#if computed.length === 0}
    <p class="donut-empty">No spending to show.</p>
  {:else}
    <svg
      class="donut-svg"
      viewBox="{-RADIUS} {-RADIUS} {SIZE} {SIZE}"
      role="img"
      aria-label="Spending breakdown by category"
    >
      {#each computed as slice, index (slice.id)}
        <path
          class="donut-slice"
          d={pathFor(slice)}
          fill={colorFor(index)}
          role="button"
          tabindex="0"
          aria-label="{slice.label}: {formatCents(slice.amountCents)} ({slice.pct}%)"
          onclick={() => onSliceClick(slice.id)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSliceClick(slice.id);
            }
          }}
          onmouseenter={() => (hoveredId = slice.id)}
          onmouseleave={() => (hoveredId = null)}
          onfocus={() => (hoveredId = slice.id)}
          onblur={() => (hoveredId = null)}
          ontouchstart={() => handleTouchStart(slice.id)}
          ontouchend={handleTouchEnd}
          ontouchcancel={handleTouchEnd}
        />
      {/each}

      {#if hoveredSlice}
        <text class="donut-center-label" x="0" y="-4" text-anchor="middle">{hoveredSlice.label}</text>
        <text class="donut-center-amount" x="0" y="16" text-anchor="middle">{formatCents(hoveredSlice.amountCents)}</text>
      {/if}
    </svg>
    <p class="donut-total">Total: {formatCents(total)}</p>
    {#if showLegend}
      <ul class="donut-legend">
        {#each computed as slice, index (slice.id)}
          <li class="donut-legend-item">
            <button type="button" class="donut-legend-button" onclick={() => onSliceClick(slice.id)}>
              <span class="donut-legend-swatch" style:background={colorFor(index)}></span>
              <span class="donut-legend-label">{slice.label}</span>
              <span class="donut-legend-amount">{formatCents(slice.amountCents)} ({slice.pct}%)</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .actualmint-category-breakdown-donut {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context for the @container query below, since it's mounted into a
       host element of unpredictable width inside an Actual report page. */
    container-type: inline-size;
  }

  .donut-empty {
    color: #555;
  }

  .donut-svg {
    width: 100%;
    max-width: 260px;
    height: auto;
  }

  .donut-slice {
    cursor: pointer;
    stroke: #fff;
    stroke-width: 1;
    transition: opacity 0.15s ease;
  }

  .donut-slice:hover,
  .donut-slice:focus-visible {
    opacity: 0.8;
    outline: none;
  }

  /* Drawn in the donut's own hollow center on hover/long-press; pointer
     events stay off so it never steals the hover/touch that's revealing
     it from the slice underneath. */
  .donut-center-label,
  .donut-center-amount {
    pointer-events: none;
    dominant-baseline: middle;
  }

  .donut-center-label {
    font-size: 11px;
    fill: #6b7280;
  }

  .donut-center-amount {
    font-size: 16px;
    font-weight: 700;
    fill: #111827;
  }

  .donut-total {
    margin: 0;
    font-weight: 600;
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .donut-legend-item {
    width: 100%;
  }

  .donut-legend-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.15rem 0;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    text-align: left;
    color: inherit;
  }

  .donut-legend-swatch {
    flex: 0 0 auto;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.15rem;
  }

  .donut-legend-label {
    flex: 1 1 auto;
    font-weight: 600;
  }

  .donut-legend-amount {
    flex: 0 0 auto;
    color: #555;
    font-size: 0.85rem;
  }

  /* Narrow (phone-width) containers: stack legend text instead of
     squeezing label and amount onto one tight line. */
  @container (max-width: 320px) {
    .donut-legend-button {
      flex-wrap: wrap;
    }
  }
</style>
