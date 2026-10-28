<script>
  import { scaleTime, scaleLinear, line as d3Line, area as d3Area } from 'd3';
  import { fetchApi } from '../api-client';

  // Same over/under-pace colors PacingBars.svelte uses for its own
  // `.pacing-fill--under`/`.pacing-fill--over` status coloring -- reused
  // here rather than inventing new ones (see task brief).
  const UNDER_PACE_COLOR = '#22c55e';
  const OVER_PACE_COLOR = '#ef4444';

  let data = $state(null);
  let errorMessage = $state(null);

  // Duplicated from PacingBars.svelte/MonthEndNet.svelte rather than
  // extracted to a shared module -- see MonthEndNet.svelte's own comment
  // on this: a 5-line function with one call site per widget, following
  // this codebase's established precedent of each widget keeping its own
  // copy. This widget is zero-config and current-month-only (v1, no month
  // picker), same posture as month-end-net.
  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async function load() {
    errorMessage = null;
    data = null;

    try {
      const month = currentMonth();
      const response = await fetchApi(`/api/burn-rate?month=${month}`);

      if (!response.ok) {
        errorMessage = `Burn rate unavailable (${response.status})`;
        return;
      }

      data = await response.json();
    } catch (err) {
      errorMessage = 'Burn rate unavailable: could not reach actualmint-api.';
    }
  }

  load();

  const WIDTH = 640;
  const HEIGHT = 320;
  const MARGIN = { top: 16, right: 16, bottom: 28, left: 64 };

  // `date` strings are always `YYYY-MM-DD` (api/src/routes/burn-rate.js);
  // parsed as local-calendar-day components rather than via `new Date(str)`
  // to avoid that string form's UTC-midnight parsing (same convention as
  // AccountBalancesChart.svelte's parseDateOnly).
  function parseDateOnly(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  // The last calendar day of the month the first loaded day belongs to --
  // the target line's own end-of-month x-position, which stays fixed for
  // the full month even though `data.days` (the actual-spend series) only
  // runs through today for the current month (see burn-rate.js).
  function lastDayOfMonth(firstDate) {
    return new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0);
  }

  let isEmpty = $derived(!data || !data.days || data.days.length === 0);

  let firstDate = $derived(!isEmpty ? parseDateOnly(data.days[0].date) : null);
  let monthEndDate = $derived(firstDate ? lastDayOfMonth(firstDate) : null);

  let xScale = $derived.by(() => {
    if (!firstDate || !monthEndDate) return null;
    return scaleTime().domain([firstDate, monthEndDate]).range([MARGIN.left, WIDTH - MARGIN.right]);
  });

  let yMax = $derived.by(() => {
    if (isEmpty) return 0;
    const maxActual = Math.max(0, ...data.days.map((d) => d.cumulativeSpendCents));
    return Math.max(data.budgetedCents, maxActual, 1);
  });

  let yScale = $derived.by(() => {
    if (!xScale) return null;
    return scaleLinear().domain([0, yMax]).nice().range([HEIGHT - MARGIN.bottom, MARGIN.top]);
  });

  // The target value, in cents, the straight-line (day 1, $0) ->
  // (last day, budgetedCents) target implies at a given date -- used both
  // to draw the dashed target line and to compare today's actual spend
  // against it for the red/green coloring below.
  function targetValueAt(date) {
    const totalMs = monthEndDate.getTime() - firstDate.getTime();
    if (totalMs <= 0) return data.budgetedCents;
    const elapsedMs = date.getTime() - firstDate.getTime();
    return data.budgetedCents * (elapsedMs / totalMs);
  }

  let targetLinePath = $derived.by(() => {
    if (!xScale || !yScale) return null;
    return d3Line()([
      [xScale(firstDate), yScale(0)],
      [xScale(monthEndDate), yScale(data.budgetedCents)],
    ]);
  });

  // "Currently" means the latest day present in `data.days` -- the API
  // only returns the current month's series through today (see
  // burn-rate.js), so the last entry IS today, read from the server's own
  // data rather than guessed client-side.
  let latestDay = $derived(!isEmpty ? data.days[data.days.length - 1] : null);

  let isOverPace = $derived.by(() => {
    if (!latestDay || !firstDate || !monthEndDate) return false;
    const targetAtLatest = targetValueAt(parseDateOnly(latestDay.date));
    return latestDay.cumulativeSpendCents > targetAtLatest;
  });

  let actualColor = $derived(isOverPace ? OVER_PACE_COLOR : UNDER_PACE_COLOR);

  let actualAreaPath = $derived.by(() => {
    if (!xScale || !yScale || isEmpty) return null;
    return d3Area()
      .x((d) => xScale(parseDateOnly(d.date)))
      .y0(yScale(0))
      .y1((d) => yScale(d.cumulativeSpendCents))(data.days);
  });

  let actualLinePath = $derived.by(() => {
    if (!xScale || !yScale || isEmpty) return null;
    return d3Line()
      .x((d) => xScale(parseDateOnly(d.date)))
      .y((d) => yScale(d.cumulativeSpendCents))(data.days);
  });

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-burn-rate-chart">
  {#if errorMessage}
    <p class="burn-rate-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="burn-rate-loading">Loading burn rate…</p>
  {:else if isEmpty}
    <p class="burn-rate-empty">Not enough spending history yet to chart.</p>
  {:else}
    <svg
      class="burn-rate-svg"
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Cumulative spend vs. straight-line budget pace"
    >
      <path
        class="burn-rate-target-line"
        d={targetLinePath}
        stroke="#6b7280"
        stroke-width="2"
        stroke-dasharray="6 4"
        fill="none"
      />

      <path class="burn-rate-actual-area" d={actualAreaPath} fill={actualColor} fill-opacity="0.15" stroke="none" />

      <path
        class="burn-rate-actual-line"
        d={actualLinePath}
        stroke={actualColor}
        stroke-width="2"
        fill="none"
      />
    </svg>

    <p class="burn-rate-summary">
      Spent {formatCents(latestDay.cumulativeSpendCents)} of {formatCents(data.budgetedCents)} budgeted
    </p>
  {/if}
</div>

<style>
  .actualmint-burn-rate-chart {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context, since it's mounted into a host element of unpredictable
       width inside an Actual report page. */
    container-type: inline-size;
  }

  .burn-rate-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .burn-rate-loading,
  .burn-rate-empty {
    color: #555;
  }

  .burn-rate-svg {
    width: 100%;
    height: auto;
  }

  .burn-rate-summary {
    margin: 0;
    font-weight: 700;
    font-size: 1.1rem;
    color: #111827;
  }
</style>
