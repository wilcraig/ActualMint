<script>
  import { untrack } from 'svelte';
  import { hierarchy, treemap } from 'd3';
  import { initialState, drillInto, zoomOut, currentMonth, buildBreakdownParams } from './breakdown-nav';
  import { fetchApi } from '../api-client';

  // Same categorical chart palette + fallback every other widget uses
  // (AccountBalancesChart.svelte's convention, also used identically by
  // SpendingSankey.svelte) -- category rectangles under a group share that
  // group's color, so the palette stays visually consistent across the
  // groups->categories drill-down.
  const CHART_QUAL_COUNT = 9;
  const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  function colorFor(index) {
    try {
      const varName = `--palette-chartQual${(index % CHART_QUAL_COUNT) + 1}`;
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (value) return value;
    } catch {
      // getComputedStyle can be unavailable in some test/SSR contexts --
      // fall through to the static fallback below.
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  const WIDTH = 720;
  const HEIGHT = 420;

  // Below this width or height, the rectangle is too small to hold a
  // legible <text> label -- SVG text has no CSS text-overflow/ellipsis
  // support the way HTML does, so rather than attempt in-SVG truncation
  // the label is simply omitted below this threshold. 40x20px roughly fits
  // "Dining" or similar short category names at the 11px font-size used
  // below; anything smaller reliably overflowed in manual testing.
  const MIN_LABEL_WIDTH = 40;
  const MIN_LABEL_HEIGHT = 20;

  // Zero-config, current-month only, same posture as burn-rate/sankey.
  // Enters at the unrestricted 'groups' level -- this widget never curates
  // a subset of groups the way the standalone donut widget can.
  let nav = $state(untrack(() => initialState({ groupIds: [] })));
  let slices = $state(null); // null while loading; [] when the level has no spending
  let errorMessage = $state(null);

  // Request-sequence guard, same pattern as SpendingBreakdownDonut.svelte:
  // load() re-fires on every navigation (groups -> categories -> back), and
  // a slower in-flight request shouldn't clobber a newer one's result.
  let loadSeq = 0;

  const TRANSFER_GROUP = /^transfers?$/i;

  async function load(currentNav) {
    const seq = ++loadSeq;
    errorMessage = null;
    slices = null;

    try {
      const params = buildBreakdownParams(currentNav, currentMonth());
      const response = await fetchApi(`/api/spending-breakdown?${params}`);
      if (seq !== loadSeq) return;

      if (!response.ok) {
        errorMessage = `Treemap unavailable (${response.status})`;
        return;
      }

      const data = await response.json();
      if (seq !== loadSeq) return;
      // A user-made "Transfers" group holds moves between accounts, not
      // spending -- same rule /api/cash-flow applies for the Sankey.
      slices = currentNav.level === 'groups' ? data.slices.filter((s) => !TRANSFER_GROUP.test(s.label.trim())) : data.slices;
    } catch {
      if (seq !== loadSeq) return;
      errorMessage = 'Treemap unavailable: could not reach actualmint-api.';
    }
  }

  $effect(() => {
    load(nav);
  });

  function handleCellClick(slice) {
    if (nav.level !== 'groups') return; // only groups drill further, into categories
    nav = drillInto(nav, slice);
  }

  function handleBack() {
    nav = zoomOut(nav);
  }

  let isEmpty = $derived(slices !== null && slices.length === 0);
  let isLoading = $derived(slices === null && !errorMessage);

  // At the groups level every cell gets its own color index. At the
  // categories level every cell shares the SAME color index -- that of the
  // group just drilled into -- so the color stays consistent across the
  // groups->categories transition (the plan's "colored by top-level group"
  // constraint, read as: a category's rectangle is colored by the group it
  // belongs to, not re-indexed independently).
  let groupColorIndex = $derived(nav.groupId ? slicesAtLastGroupsLoad.findIndex((g) => g.id === nav.groupId) : -1);

  // Remembers the groups list from the last time the widget was actually AT
  // the groups level, so that after drilling into categories (which
  // replaces `slices` with that group's categories) we can still look up
  // which index the drilled-into group had. Recomputed fresh each time
  // `slices` updates while at the groups level.
  let slicesAtLastGroupsLoad = $state([]);
  $effect(() => {
    if (nav.level === 'groups' && slices) {
      slicesAtLastGroupsLoad = slices;
    }
  });

  let cells = $derived.by(() => {
    if (!slices || slices.length === 0) return null;

    const root = hierarchy({ children: slices }).sum((d) => d.amountCents);
    treemap().size([WIDTH, HEIGHT]).padding(1)(root);

    return (root.children || []).map((leaf, index) => {
      const colorIndex = nav.level === 'groups' ? index : Math.max(groupColorIndex, 0);
      return {
        id: leaf.data.id,
        label: leaf.data.label,
        amountCents: leaf.data.amountCents,
        x0: leaf.x0,
        y0: leaf.y0,
        x1: leaf.x1,
        y1: leaf.y1,
        colorIndex,
      };
    });
  });

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-spending-treemap">
  <nav class="treemap-breadcrumb" aria-label="Breakdown level">
    <button
      type="button"
      class="breadcrumb-item"
      class:breadcrumb-current={nav.level === 'groups'}
      onclick={handleBack}
      disabled={nav.level === 'groups'}
    >
      All spending
    </button>
    {#if nav.groupName}
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-item breadcrumb-current">{nav.groupName}</span>
    {/if}
  </nav>

  {#if errorMessage}
    <p class="treemap-error" role="alert">{errorMessage}</p>
  {:else if isLoading}
    <p class="treemap-loading">Loading spending treemap…</p>
  {:else if isEmpty}
    <p class="treemap-empty">No spending to show.</p>
  {:else if cells}
    <svg
      class="treemap-svg"
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Spending treemap by {nav.level === 'groups' ? 'group' : 'category'}"
    >
      {#each cells as cell (cell.id)}
        {@const cellWidth = Math.max(cell.x1 - cell.x0, 0)}
        {@const cellHeight = Math.max(cell.y1 - cell.y0, 0)}
        {@const showLabel = cellWidth >= MIN_LABEL_WIDTH && cellHeight >= MIN_LABEL_HEIGHT}
        {#if nav.level === 'groups'}
          <g
            class="treemap-cell treemap-cell--clickable"
            data-cell-id={cell.id}
            transform="translate({cell.x0},{cell.y0})"
            role="button"
            tabindex="0"
            aria-label={`${cell.label}: ${formatCents(cell.amountCents)}, click to view categories`}
            onclick={() => handleCellClick(cell)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleCellClick(cell);
              }
            }}
          >
            <rect class="treemap-cell-rect" width={cellWidth} height={cellHeight} fill={colorFor(cell.colorIndex)} />
            {#if showLabel}
              <text class="treemap-cell-label" x="4" y="14">{cell.label}</text>
            {/if}
          </g>
        {:else}
          <g class="treemap-cell" data-cell-id={cell.id} transform="translate({cell.x0},{cell.y0})">
            <rect class="treemap-cell-rect" width={cellWidth} height={cellHeight} fill={colorFor(cell.colorIndex)} />
            {#if showLabel}
              <text class="treemap-cell-label" x="4" y="14">{cell.label}</text>
            {/if}
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .actualmint-spending-treemap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    container-type: inline-size;
  }

  .treemap-breadcrumb {
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

  .breadcrumb-item:disabled {
    cursor: default;
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

  .treemap-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .treemap-loading,
  .treemap-empty {
    color: #555;
  }

  .treemap-svg {
    width: 100%;
    height: auto;
  }

  .treemap-cell-rect {
    stroke: #fff;
    stroke-width: 1;
  }

  .treemap-cell--clickable {
    cursor: pointer;
  }

  .treemap-cell--clickable:hover .treemap-cell-rect,
  .treemap-cell--clickable:focus-visible .treemap-cell-rect {
    opacity: 0.8;
    outline: none;
  }

  .treemap-cell-label {
    font-size: 11px;
    fill: #fff;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 2px;
  }
</style>
