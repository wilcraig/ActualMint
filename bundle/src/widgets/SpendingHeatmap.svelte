<script>
  import { scaleQuantile } from 'd3';
  import { fetchApi } from '../api-client';

  // 'month' (the default) requests the last 30 days; 'year' requests the
  // last 366 days (the longest a single-year range can be, matching
  // spending-calendar.js's own MAX_RANGE_DAYS cap).
  let { range = 'month' } = $props();

  let data = $state(null);
  let errorMessage = $state(null);

  const RANGE_DAYS = {
    month: 30,
    year: 366,
  };

  // Midnight of `date`'s own local calendar day -- same stable-boundary
  // convention as api/src/routes/account-balances.js's/spending-calendar.js's
  // own startOfLocalDay/parseDateOnly helpers.
  function todayMidnight() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function formatDateOnly(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  async function load(currentRange) {
    errorMessage = null;
    data = null;

    try {
      const days = RANGE_DAYS[currentRange] ?? RANGE_DAYS.month;
      const end = todayMidnight();
      const start = addDays(end, -(days - 1));
      const params = new URLSearchParams({ start: formatDateOnly(start), end: formatDateOnly(end) });
      const response = await fetchApi(`/api/spending-calendar?${params}`);

      if (!response.ok) {
        errorMessage = `Spending heatmap unavailable (${response.status})`;
        return;
      }

      data = await response.json();
    } catch (err) {
      errorMessage = 'Spending heatmap unavailable: could not reach actualmint-api.';
    }
  }

  $effect(() => {
    load(range);
  });

  const BUCKET_COUNT = 5;
  // Bucket 0 is reserved for exact-zero days ("no-spend green") -- buckets
  // 1-4 run gray through amber through red for increasing spend intensity.
  const BUCKET_COLORS = ['#bbf7d0', '#d1d5db', '#fcd34d', '#fb923c', '#dc2626'];

  // Quantile-bucket every day's amountCents into one of BUCKET_COUNT-1
  // buckets (1..4), using only the *nonzero* days as the quantile domain --
  // zero-spend days are always forced into bucket 0 regardless of what a
  // quantile scale would otherwise do with them (see the brief: a quantile
  // scale alone wouldn't necessarily group every zero-spend day together).
  //
  // d3.scaleQuantile() needs at least two distinct values in its domain to
  // build real quantile breakpoints; a domain of one repeated value (every
  // nonzero day spending the exact same amount) still works without
  // throwing or producing NaN -- it just maps everything to the same
  // bucket, which is also correct behavior here (zero variance to bucket
  // by). An empty domain (every day is exactly $0) never calls
  // scaleQuantile() at all.
  let bucketedDays = $derived.by(() => {
    if (!data || !data.days) return [];

    const nonzeroAmounts = data.days.map((d) => d.amountCents).filter((c) => c > 0);

    let scale = null;
    if (nonzeroAmounts.length > 0) {
      scale = scaleQuantile()
        .domain(nonzeroAmounts)
        .range([1, 2, 3, 4]);
    }

    return data.days.map((day) => {
      const bucket = day.amountCents === 0 || !scale ? 0 : scale(day.amountCents);
      return { ...day, bucket };
    });
  });

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-spending-heatmap">
  {#if errorMessage}
    <p class="heatmap-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="heatmap-loading">Loading spending heatmap…</p>
  {:else}
    <div class="heatmap-grid">
      {#each bucketedDays as day (day.date)}
        <div
          class="heatmap-day"
          data-bucket={day.bucket}
          style:background-color={BUCKET_COLORS[day.bucket]}
          title="{day.date}: {formatCents(day.amountCents)}"
        ></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .actualmint-spending-heatmap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    container-type: inline-size;
  }

  .heatmap-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .heatmap-loading {
    color: #555;
  }

  .heatmap-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12px, 1fr));
    grid-auto-flow: row;
    gap: 3px;
  }

  .heatmap-day {
    aspect-ratio: 1 / 1;
    border-radius: 2px;
    min-width: 10px;
  }
</style>
