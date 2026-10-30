<script>
  import { scaleTime, scaleLinear, line as d3Line, area as d3Area } from 'd3';
  import { chartModel, money, formatDay, parseDateOnly } from './forecast-chart-data';

  // One account's forecast from Check now (an insights-api AccountResult):
  // the balance line, the warning level (dashed), the stretch below it
  // shaded red, scheduled events marked and labelled, the breach marked in
  // red, and the lowest balance underneath. Sizing and style follow
  // BurnRateChart.svelte; text and neutral strokes use Actual's theme
  // variables so the Fresh and dark themes recolor them.
  let { result } = $props();

  // BurnRateChart.svelte's under/over-pace colors, reused.
  const GREEN = '#22c55e';
  const RED = '#ef4444';

  const WIDTH = 640;
  const HEIGHT = 320;
  const MARGIN = { top: 36, right: 16, bottom: 28, left: 64 };
  const LABEL_STEP = 12;

  let model = $derived(chartModel(result));
  let hasChart = $derived(!!model && model.points.length > 0);

  let xScale = $derived.by(() => {
    if (!hasChart) return null;
    const first = model.points[0].date;
    const last = model.points[model.points.length - 1].date;
    const end = last.getTime() === first.getTime() ? new Date(first.getTime() + 86400000) : last;
    return scaleTime().domain([first, end]).range([MARGIN.left, WIDTH - MARGIN.right]);
  });

  let yScale = $derived.by(() => {
    if (!hasChart) return null;
    const values = [...model.points.map((p) => p.balanceCents), model.levelCents];
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.08, 100);
    return scaleLinear().domain([lo - pad, hi + pad]).nice().range([HEIGHT - MARGIN.bottom, MARGIN.top]);
  });

  let linePath = $derived(
    hasChart ? d3Line().x((p) => xScale(p.date)).y((p) => yScale(p.balanceCents))(model.points) : null,
  );

  let belowPaths = $derived(
    hasChart
      ? model.belowRuns.map((run) =>
          d3Area()
            .x((p) => xScale(p.date))
            .y0(yScale(model.levelCents))
            .y1((p) => yScale(p.balanceCents))(run),
        )
      : [],
  );

  let levelY = $derived(hasChart ? yScale(model.levelCents) : 0);
  let xTicks = $derived(xScale ? xScale.ticks(Math.min(6, model.points.length)) : []);
  let yTicks = $derived(yScale ? yScale.ticks(4) : []);

  // End-of-day balance on a date, from the result's days (an event marker
  // sits after that day's events).
  function balanceOn(date) {
    const t = date.getTime();
    const day = (result.days || []).find((d) => parseDateOnly(d.date).getTime() === t);
    return day ? day.balanceCents : model.levelCents;
  }

  // Event markers with label positions: alternating heights so labels on
  // nearby days don't sit on top of each other; flipped below the point
  // when there's no room above it; anchored inward near the edges.
  let eventMarkers = $derived.by(() => {
    if (!hasChart) return [];
    return model.markers
      .filter((m) => m.kind !== 'breach')
      .map((m, i) => {
        const x = xScale(m.date);
        const y = yScale(balanceOn(m.date));
        const lift = 10 + (i % 2) * LABEL_STEP;
        let labelY = y - lift;
        if (labelY < 10) labelY = y + lift + 6;
        let anchor = 'middle';
        if (x < MARGIN.left + 50) anchor = 'start';
        else if (x > WIDTH - MARGIN.right - 50) anchor = 'end';
        return { ...m, x, y, labelY, anchor };
      });
  });

  let breachMarker = $derived.by(() => {
    if (!hasChart || !result.breach) return null;
    const m = model.markers.find((mk) => mk.kind === 'breach');
    return m ? { x: xScale(m.date), y: yScale(result.breach.balanceCents) } : null;
  });

  function formatTick(date) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

{#if hasChart}
  <div class="actualmint-forecast-chart">
    {#if model.headline}
      <p class="forecast-headline">{model.headline}</p>
    {/if}
    <svg class="forecast-svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="Projected balance for {result.accountName}">
      {#each yTicks as tick (tick)}
        <line class="forecast-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} />
        <text class="forecast-axis-label forecast-axis-label--y" x={MARGIN.left - 6} y={yScale(tick) + 3}>{money(tick)}</text>
      {/each}
      {#each xTicks as tick (tick.getTime())}
        <text class="forecast-axis-label forecast-axis-label--x" x={xScale(tick)} y={HEIGHT - MARGIN.bottom + 16}>{formatTick(tick)}</text>
      {/each}

      {#each belowPaths as d, i (i)}
        <path class="forecast-below-area" {d} fill={RED} fill-opacity="0.2" stroke="none" />
      {/each}

      <line class="forecast-level-line" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={levelY} y2={levelY}
        stroke-width="1.5" stroke-dasharray="6 4" />
      <text class="forecast-level-label" x={WIDTH - MARGIN.right} y={levelY - 4}>Warning level {money(model.levelCents)}</text>

      <path class="forecast-balance-line" d={linePath} stroke-width="2" fill="none" />

      {#each eventMarkers as m, i (i)}
        <circle class="forecast-event-marker forecast-event-marker--{m.kind}" cx={m.x} cy={m.y} r="3.5"
          fill={m.kind === 'inflow' ? GREEN : RED} />
        <text class="forecast-event-label" x={m.x} y={m.labelY} text-anchor={m.anchor}>{m.label}</text>
      {/each}

      {#if breachMarker}
        <circle class="forecast-breach-marker" cx={breachMarker.x} cy={breachMarker.y} r="6" fill={RED} />
      {/if}
    </svg>
    {#if model.lowest}
      <p class="forecast-lowest">
        Lowest balance <strong class:forecast-lowest--below={model.lowest.balanceCents < model.levelCents}>{money(model.lowest.balanceCents)}</strong>
        on {formatDay(model.lowest.date)}
      </p>
    {/if}
  </div>
{/if}

<style>
  .actualmint-forecast-chart {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    box-sizing: border-box;
    margin: 8px 0;
  }

  .forecast-headline {
    margin: 0;
    font-weight: 700;
    color: #ef4444;
  }

  .forecast-svg {
    width: 100%;
    height: auto;
  }

  .forecast-grid {
    stroke: var(--color-pageTextSubdued, #6b7280);
    stroke-opacity: 0.15;
  }

  .forecast-axis-label,
  .forecast-event-label,
  .forecast-level-label {
    font-size: 10px;
    fill: var(--color-pageTextSubdued, #6b7280);
  }

  .forecast-axis-label--x {
    text-anchor: middle;
  }

  .forecast-axis-label--y,
  .forecast-level-label {
    text-anchor: end;
  }

  .forecast-event-label {
    fill: var(--color-pageText, #111827);
  }

  .forecast-level-line {
    stroke: var(--color-pageTextSubdued, #6b7280);
  }

  .forecast-balance-line {
    stroke: var(--palette-chartQual1, #2563eb);
  }

  .forecast-event-marker,
  .forecast-breach-marker {
    stroke: var(--color-pageBackground, #fff);
    stroke-width: 1.5;
  }

  .forecast-lowest {
    margin: 0;
    font-size: 12px;
  }

  .forecast-lowest--below {
    color: #ef4444;
  }
</style>
