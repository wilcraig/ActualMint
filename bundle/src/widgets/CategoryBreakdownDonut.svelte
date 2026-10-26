<script>
  import { arc as d3Arc } from 'd3';
  import { computeSlices } from './donut-data';

  let { slices = [], total = 0, onSliceClick = () => {} } = $props();

  const SIZE = 200;
  const RADIUS = SIZE / 2;
  const INNER_RADIUS = RADIUS * 0.6;

  const arcGenerator = d3Arc().innerRadius(INNER_RADIUS).outerRadius(RADIUS);

  // Deterministic, repeatable fallback palette (not brand-specific) so
  // slices stay visually distinct without depending on category data
  // carrying its own color.
  const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  let computed = $derived(computeSlices(slices));

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
        />
      {/each}
    </svg>
    <p class="donut-total">Total: {formatCents(total)}</p>
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
