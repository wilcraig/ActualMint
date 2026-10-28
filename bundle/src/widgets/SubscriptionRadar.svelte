<script>
  import { scaleTime } from 'd3';
  import { fetchApi } from '../api-client';

  // Same categorical chart palette + fallback every other group-colored
  // widget uses, byte-for-byte (AccountBalancesChart.svelte's convention,
  // also used identically by SpendingSankey.svelte and SpendingTreemap.svelte).
  const CHART_QUAL_COUNT = 9;
  const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  // Not part of the qualitative palette above -- an ungrouped item (no
  // resolvable category group) must never land on index 0 and silently look
  // like it shares a real group's color.
  const UNGROUPED_COLOR = '#9ca3af';

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

  let items = $state(null); // null while loading; [] once loaded with nothing upcoming
  let errorMessage = $state(null);

  const WIDTH = 720;
  const HEIGHT = 160;
  const MARGIN = { top: 36, right: 24, bottom: 36, left: 24 };
  const WINDOW_DAYS = 30;

  // Same stable-boundary pattern bills-timeline.js/month-end-projection.js
  // use server-side -- here client-side, since this widget runs entirely in
  // the browser (server clock is irrelevant to it; see component brief).
  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  // Duplicated from PacingBars.svelte/BurnRateChart.svelte rather than
  // extracted to a shared module -- same established precedent: a small
  // function with one call site per widget, each widget keeps its own copy.
  function monthString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function formatDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // `date` strings from /api/bills-timeline are always `YYYY-MM-DD`; parsed
  // as local-calendar-day components rather than via `new Date(str)` to
  // avoid that string form's UTC-midnight parsing (same convention as
  // AccountBalancesChart.svelte's/BurnRateChart.svelte's parseDateOnly).
  function parseDateOnly(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  async function load() {
    errorMessage = null;
    items = null;

    try {
      const today = startOfLocalDay(new Date());
      const windowEnd = addDays(today, WINDOW_DAYS);

      const currentMonth = monthString(today);
      const months = [currentMonth];
      const windowEndMonth = monthString(windowEnd);
      if (windowEndMonth !== currentMonth) {
        months.push(windowEndMonth);
      }

      const responses = await Promise.all(months.map((month) => fetchApi(`/api/bills-timeline?month=${month}`)));

      const failed = responses.find((response) => !response.ok);
      if (failed) {
        errorMessage = `Subscription renewal radar unavailable (${failed.status})`;
        return;
      }

      const bodies = await Promise.all(responses.map((response) => response.json()));
      const merged = bodies.flatMap((body) => body.items || []);

      const windowEndStr = formatDate(windowEnd);
      items = merged.filter((item) => item.date <= windowEndStr);
    } catch {
      errorMessage = 'Subscription renewal radar unavailable: could not reach actualmint-api.';
    }
  }

  load();

  let today = $derived(startOfLocalDay(new Date()));
  let windowEnd = $derived(addDays(today, WINDOW_DAYS));

  let xScale = $derived(scaleTime().domain([today, windowEnd]).range([MARGIN.left, WIDTH - MARGIN.right]));

  // Each distinct groupName gets a stable color index, assigned the first
  // time it's seen in date-sorted item order (this widget's own call --
  // documented here per the task brief -- rather than alphabetical, since
  // that order is otherwise arbitrary and first-seen reads naturally as
  // "in the order they appear on the timeline"). `null` (ungrouped) never
  // gets a palette index at all; it always uses the dedicated neutral
  // UNGROUPED_COLOR instead, so it can never collide with a real group that
  // also resolved to index 0.
  let sortedItems = $derived.by(() => {
    if (!items) return [];
    return [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  });

  let dots = $derived.by(() => {
    const groupIndexByName = new Map();
    let nextIndex = 0;

    return sortedItems.map((item, i) => {
      let color;
      if (item.groupName) {
        if (!groupIndexByName.has(item.groupName)) {
          groupIndexByName.set(item.groupName, nextIndex++);
        }
        color = colorFor(groupIndexByName.get(item.groupName));
      } else {
        color = UNGROUPED_COLOR;
      }

      return {
        key: `${item.scheduleId}-${item.date}-${i}`,
        scheduleId: item.scheduleId,
        payeeName: item.payeeName,
        date: item.date,
        amountCents: item.amountCents,
        cx: xScale(parseDateOnly(item.date)),
        color,
        // Alternating above/below the axis, staggered by index, to reduce
        // same-day label collisions -- same-date items naturally land at
        // adjacent indices once sorted chronologically above.
        above: i % 2 === 0,
      };
    });
  });

  const AXIS_Y = HEIGHT / 2;
  const DOT_RADIUS = 5;
  const LABEL_OFFSET = 22;

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  let isEmpty = $derived(items !== null && items.length === 0);
</script>

<div class="actualmint-subscription-radar">
  {#if errorMessage}
    <p class="radar-error" role="alert">{errorMessage}</p>
  {:else if items === null}
    <p class="radar-loading">Loading subscription renewal radar…</p>
  {:else if isEmpty}
    <p class="radar-empty">Nothing upcoming in the next 30 days.</p>
  {:else}
    <svg
      class="radar-svg"
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Upcoming scheduled transactions in the next 30 days"
    >
      <line
        class="radar-axis"
        x1={MARGIN.left}
        y1={AXIS_Y}
        x2={WIDTH - MARGIN.right}
        y2={AXIS_Y}
        stroke="#d1d5db"
        stroke-width="1"
      />

      {#each dots as dot (dot.key)}
        <g class="radar-item">
          <line
            class="radar-stem"
            x1={dot.cx}
            y1={AXIS_Y}
            x2={dot.cx}
            y2={AXIS_Y + (dot.above ? -LABEL_OFFSET + 6 : LABEL_OFFSET - 6)}
            stroke={dot.color}
            stroke-width="1"
          />
          <text
            class="radar-label"
            x={dot.cx}
            y={AXIS_Y + (dot.above ? -LABEL_OFFSET : LABEL_OFFSET + 10)}
            text-anchor="middle"
          >
            {dot.payeeName} · {formatCents(dot.amountCents)}
          </text>
          <circle
            class="radar-dot"
            data-schedule-id={dot.scheduleId}
            cx={dot.cx}
            cy={AXIS_Y}
            r={DOT_RADIUS}
            fill={dot.color}
          />
        </g>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .actualmint-subscription-radar {
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

  .radar-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .radar-loading,
  .radar-empty {
    color: #555;
  }

  .radar-svg {
    width: 100%;
    height: auto;
  }

  .radar-label {
    font-size: 10px;
    fill: #374151;
  }
</style>
