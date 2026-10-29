<script>
  import { mount, unmount } from 'svelte';
  import { scaleQuantile } from 'd3';
  import { fetchApi } from '../api-client';
  import DayBreakdownModal from './DayBreakdownModal.svelte';

  // 'month' (the default) shows one month as a full calendar, with arrows to
  // step back through earlier months; 'year' shows the last 12 months as
  // small calendars side by side.
  let { range = 'month' } = $props();

  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const NO_SPEND_COLOR = '#bbf7d0';
  const SPEND_COLORS = ['#fef3c7', '#fcd34d', '#fb923c', '#dc2626'];

  let monthOffset = $state(0); // 0 = this month, -1 = last month, ...
  let data = $state(null);
  let errorMessage = $state(null);

  const pad = (n) => String(n).padStart(2, '0');
  const formatDateOnly = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function todayMidnight() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // The months on screen, oldest first, each as its first day.
  let months = $derived.by(() => {
    const today = todayMidnight();
    if (range === 'year') {
      return Array.from({ length: 12 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1));
    }
    return [new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)];
  });

  let loadSeq = 0;

  async function load(shownMonths) {
    const seq = ++loadSeq;
    errorMessage = null;
    data = null;

    const first = shownMonths[0];
    const last = shownMonths[shownMonths.length - 1];
    const monthEnd = new Date(last.getFullYear(), last.getMonth() + 1, 0);
    const today = todayMidnight();
    const end = monthEnd < today ? monthEnd : today;

    try {
      const params = new URLSearchParams({ start: formatDateOnly(first), end: formatDateOnly(end) });
      const response = await fetchApi(`/api/spending-calendar?${params}`);
      if (seq !== loadSeq) return;
      if (!response.ok) {
        errorMessage = `Spending calendar unavailable (${response.status})`;
        return;
      }
      const body = await response.json();
      if (seq !== loadSeq) return;
      data = body;
    } catch {
      if (seq !== loadSeq) return;
      errorMessage = 'Spending calendar unavailable: could not reach insights-api.';
    }
  }

  $effect(() => {
    load(months);
  });

  let amountsByDate = $derived(new Map((data?.days || []).map((d) => [d.date, d.amountCents])));

  // Quantile buckets over the days that had any spending, so the colors
  // spread evenly across this budget's own typical days. Zero-spend days
  // are always their own green bucket.
  let scale = $derived.by(() => {
    const nonzero = (data?.days || []).map((d) => d.amountCents).filter((c) => c > 0);
    return nonzero.length > 0 ? scaleQuantile().domain(nonzero).range([0, 1, 2, 3]) : null;
  });

  let legend = $derived.by(() => {
    if (!scale) return [];
    const cuts = scale.quantiles();
    return SPEND_COLORS.map((color, i) => {
      const low = i === 0 ? null : cuts[i - 1];
      const high = i < cuts.length ? cuts[i] : null;
      const label = low == null ? `under ${dollars(high)}` : high == null ? `${dollars(low)}+` : `${dollars(low)}–${dollars(high)}`;
      return { color, label };
    });
  });

  function calendarCells(monthStart) {
    const today = todayMidnight();
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: monthStart.getDay() }, () => null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const key = formatDateOnly(date);
      const future = date > today;
      const amountCents = future ? null : (amountsByDate.get(key) ?? 0);
      const bucket = amountCents > 0 && scale ? scale(amountCents) : null;
      cells.push({
        key,
        day,
        future,
        amountCents,
        color: future ? null : bucket == null ? NO_SPEND_COLOR : SPEND_COLORS[bucket],
        dark: bucket === 3,
      });
    }
    return cells;
  }

  function monthTotal(monthStart) {
    const prefix = `${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}-`;
    let total = 0;
    for (const [date, cents] of amountsByDate) if (date.startsWith(prefix)) total += cents;
    return Math.max(total, 0);
  }

  function dollars(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }

  function compactDollars(cents) {
    const value = cents / 100;
    if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    return `$${Math.round(value)}`;
  }

  const monthTitle = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shortMonthTitle = (d) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  let modalInstance = null;

  function closeDay() {
    if (modalInstance) {
      unmount(modalInstance);
      modalInstance = null;
    }
  }

  function openDay(cell) {
    closeDay();
    const [y, m, d] = cell.key.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    modalInstance = mount(DayBreakdownModal, {
      target: document.body,
      props: { date: cell.key, title: `${label} · ${dollars(cell.amountCents)}`, onClose: closeDay },
    });
  }

  $effect(() => closeDay);
</script>

<div class="actualmint-spending-heatmap" class:heatmap-year={range === 'year'}>
  {#if range !== 'year'}
    <div class="heatmap-header">
      <button type="button" class="heatmap-nav" aria-label="Previous month" onclick={() => monthOffset--}>‹</button>
      <div class="heatmap-title">
        <span class="heatmap-month">{monthTitle(months[0])}</span>
        {#if data}<span class="heatmap-total">{dollars(monthTotal(months[0]))} spent</span>{/if}
      </div>
      <button type="button" class="heatmap-nav" aria-label="Next month" disabled={monthOffset >= 0} onclick={() => monthOffset++}>›</button>
    </div>
  {/if}

  {#if errorMessage}
    <p class="heatmap-error" role="alert">{errorMessage}</p>
  {:else if data === null}
    <p class="heatmap-loading">Loading spending calendar…</p>
  {:else}
    <div class="heatmap-months">
      {#each months as monthStart (monthStart.getTime())}
        <div class="heatmap-calendar">
          {#if range === 'year'}
            <div class="heatmap-mini-title">{shortMonthTitle(monthStart)} <span>{compactDollars(monthTotal(monthStart))}</span></div>
          {/if}
          <div class="heatmap-grid">
            {#each WEEKDAYS as weekday, i (i)}
              <div class="heatmap-weekday">{weekday}</div>
            {/each}
            {#each calendarCells(monthStart) as cell, i (cell ? cell.key : `blank-${i}`)}
              {#if !cell}
                <div class="heatmap-blank"></div>
              {:else if cell.amountCents > 0}
                <button
                  type="button"
                  class="heatmap-day heatmap-day--spend"
                  class:heatmap-day--dark={cell.dark}
                  data-date={cell.key}
                  style:background-color={cell.color}
                  title="{cell.key}: {dollars(cell.amountCents)}"
                  aria-label="{cell.key}: {dollars(cell.amountCents)} spent, show breakdown"
                  onclick={() => openDay(cell)}
                >
                  <span class="heatmap-day-number">{cell.day}</span>
                  {#if range !== 'year'}<span class="heatmap-day-amount">{compactDollars(cell.amountCents)}</span>{/if}
                </button>
              {:else}
                <div
                  class="heatmap-day"
                  class:heatmap-day--future={cell.future}
                  data-date={cell.key}
                  style:background-color={cell.color}
                  title={cell.future
                    ? cell.key
                    : cell.amountCents < 0
                      ? `${cell.key}: refunds exceeded spending by ${dollars(-cell.amountCents)}`
                      : `${cell.key}: no spending`}
                >
                  <span class="heatmap-day-number">{cell.day}</span>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <div class="heatmap-legend">
      <span class="legend-item"><span class="legend-swatch" style:background-color={NO_SPEND_COLOR}></span>No spending</span>
      {#each legend as item (item.color)}
        <span class="legend-item"><span class="legend-swatch" style:background-color={item.color}></span>{item.label}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .actualmint-spending-heatmap {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }

  .heatmap-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .heatmap-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .heatmap-month {
    font-weight: 600;
    font-size: 1rem;
  }

  .heatmap-total {
    font-size: 0.85rem;
    color: #6b7280;
  }

  .heatmap-nav {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    width: 2rem;
    height: 2rem;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    color: inherit;
  }

  .heatmap-nav:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .heatmap-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .heatmap-loading {
    color: #555;
  }

  .heatmap-months {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .heatmap-year .heatmap-months {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem 1rem;
  }

  .heatmap-mini-title {
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .heatmap-mini-title span {
    font-weight: 400;
    color: #6b7280;
  }

  .heatmap-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .heatmap-weekday {
    text-align: center;
    font-size: 0.7rem;
    color: #6b7280;
    padding-bottom: 2px;
  }

  .heatmap-day {
    min-height: 3rem;
    border-radius: 4px;
    padding: 3px 5px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    box-sizing: border-box;
    border: none;
    font: inherit;
    color: #111827;
    text-align: left;
  }

  .heatmap-year .heatmap-day {
    min-height: 0;
    aspect-ratio: 1 / 1;
    padding: 1px 2px;
    border-radius: 2px;
  }

  .heatmap-day--spend {
    cursor: pointer;
  }

  .heatmap-day--spend:hover,
  .heatmap-day--spend:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: -2px;
  }

  .heatmap-day--dark {
    color: #fff;
  }

  .heatmap-day--future {
    border: 1px dashed #e5e7eb;
    color: #9ca3af;
  }

  .heatmap-day-number {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .heatmap-year .heatmap-day-number {
    font-size: 0.6rem;
    font-weight: 400;
  }

  .heatmap-day-amount {
    font-size: 0.8rem;
    align-self: flex-end;
  }

  .heatmap-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.9rem;
    font-size: 0.75rem;
    color: #4b5563;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .legend-swatch {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 2px;
  }
</style>
