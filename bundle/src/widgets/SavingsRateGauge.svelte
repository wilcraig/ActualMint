<script>
  import { arc as d3Arc } from 'd3';
  import { fetchApi } from '../api-client';

  // Bare array of category-group ids to count as savings rather than
  // spending (e.g. a brokerage-transfer group), same empty/omitted-means-
  // "none selected" convention as pacing-bars' categoryIds and
  // savings-goals-thermometers' categoryIds -- forwarded straight through
  // to GET /api/savings-rate's own investmentGroupIds param.
  let { investmentGroupIds = [] } = $props();

  let data = $state(null);
  let errorMessage = $state(null);

  const SIZE = 200;
  const RADIUS = SIZE / 2;
  const INNER_RADIUS = RADIUS * 0.6;

  // Half-donut: fixed -90deg..+90deg sweep (CategoryBreakdownDonut.svelte's
  // full donut uses the same d3Arc().innerRadius(...).outerRadius(...) API
  // but sweeps a full circle across its pie slices; here there's only ever
  // one "slice" -- the filled portion of a semicircle -- so the start/end
  // angles are fixed and only the end angle of the *fill* arc moves with
  // the rate).
  const START_ANGLE = -Math.PI / 2;
  const END_ANGLE = Math.PI / 2;

  const arcGenerator = d3Arc().innerRadius(INNER_RADIUS).outerRadius(RADIUS);
  const trackPath = arcGenerator({ startAngle: START_ANGLE, endAngle: END_ANGLE });

  // Thresholds for the red/amber/green fill color, this task's own call
  // (brief: "not configurable"): below 0% saved is red (spending more than
  // earned net of investments), 0-20% is amber (saving something but thin),
  // 20%+ is green (a healthy savings rate).
  const RED_AMBER_THRESHOLD = 0;
  const AMBER_GREEN_THRESHOLD = 0.2;
  const RED_COLOR = '#dc2626';
  const AMBER_COLOR = '#f59e0b';
  const GREEN_COLOR = '#16a34a';

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
      const params = new URLSearchParams({ month, investmentGroupIds: investmentGroupIds.join(',') });
      const response = await fetchApi(`/api/savings-rate?${params}`);

      if (!response.ok) {
        errorMessage = `Savings rate unavailable (${response.status})`;
        return;
      }

      data = await response.json();
    } catch (err) {
      errorMessage = 'Savings rate unavailable: could not reach insights-api.';
    }
  }

  load();

  function colorFor(rate) {
    if (rate < RED_AMBER_THRESHOLD) return RED_COLOR;
    if (rate < AMBER_GREEN_THRESHOLD) return AMBER_COLOR;
    return GREEN_COLOR;
  }

  // The fill's geometry is clamped to [0, 1] (a rate below 0% or above
  // 100% would otherwise sweep past the semicircle or reverse direction),
  // but the raw rate is still what's displayed as text below -- a -15% or
  // 140% month should read as exactly that, not a clamped "0%"/"100%".
  function clampedFraction(rate) {
    return Math.max(0, Math.min(1, rate));
  }

  function fillPath(rate) {
    const endAngle = START_ANGLE + clampedFraction(rate) * (END_ANGLE - START_ANGLE);
    return arcGenerator({ startAngle: START_ANGLE, endAngle });
  }

  function formatPct(rate) {
    return `${Math.round(rate * 100)}%`;
  }
</script>

<div class="actualmint-savings-rate-gauge">
  {#if errorMessage}
    <p class="gauge-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="gauge-loading">Loading savings rate…</p>
  {:else if data.rate === null}
    <p class="gauge-no-income">No income this month -- savings rate is not meaningful.</p>
  {:else}
    <svg class="gauge-svg" viewBox="{-RADIUS} {-RADIUS} {SIZE} {RADIUS + 10}" role="img" aria-label="Net savings rate: {formatPct(data.rate)}">
      <path class="gauge-track-arc" d={trackPath} fill="#e5e7eb" />
      <path class="gauge-fill-arc" d={fillPath(data.rate)} fill={colorFor(data.rate)} />
      <text class="gauge-pct-label" x="0" y="-8" text-anchor="middle">{formatPct(data.rate)}</text>
    </svg>
  {/if}
</div>

<style>
  .actualmint-savings-rate-gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    container-type: inline-size;
  }

  .gauge-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .gauge-no-income {
    color: #555;
  }

  .gauge-svg {
    width: 100%;
    max-width: 260px;
    height: auto;
  }

  .gauge-pct-label {
    font-size: 28px;
    font-weight: 700;
    fill: #111827;
    dominant-baseline: middle;
  }
</style>
