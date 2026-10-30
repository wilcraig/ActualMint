// Pure data for ForecastChart.svelte: turns one Check now AccountResult
// (insights-api's forecast) into what the chart draws. No DOM, no D3.
//
// Dates arrive as 'YYYY-MM-DD' and are parsed as LOCAL calendar days from
// their parts; `new Date('YYYY-MM-DD')` is UTC midnight and would land on
// the previous day in US time zones.

const MAX_NAME = 18;

export function parseDateOnly(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Whole US dollars, like the other widgets' inline toLocaleString calls.
export function money(cents) {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatDay(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncate(name) {
  const text = String(name ?? '');
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text;
}

function eventLabel(event) {
  const sign = event.amountCents < 0 ? '−' : '+';
  return `${truncate(event.name)} ${sign}${money(Math.abs(event.amountCents))}`;
}

// The balance line. Each day is its end-of-day balance; on a day with
// scheduled events, a point just before them (same date, balance without
// that day's events) is added first, so the line follows the allowance
// slope between days and drops (or jumps) vertically on the event day.
function buildPoints(days, events) {
  const eventSum = new Map();
  for (const e of events) eventSum.set(e.date, (eventSum.get(e.date) || 0) + e.amountCents);
  const points = [];
  for (const day of days) {
    const date = parseDateOnly(day.date);
    const sum = eventSum.get(day.date);
    if (sum) points.push({ date, balanceCents: day.balanceCents - sum });
    points.push({ date, balanceCents: day.balanceCents });
  }
  return points;
}

// Where the straight segment a->b meets the level (linear in time).
function crossing(a, b, levelCents) {
  const t = (levelCents - a.balanceCents) / (b.balanceCents - a.balanceCents);
  const ms = a.date.getTime() + t * (b.date.getTime() - a.date.getTime());
  return { date: new Date(ms), balanceCents: levelCents };
}

// Runs of the line strictly below the level, each bounded by the exact
// level crossings (or the series' ends), so a shaded area between a run
// and the level starts and ends where the line actually crosses it.
export function belowRuns(points, levelCents) {
  const runs = [];
  let run = null;
  points.forEach((p, i) => {
    const below = p.balanceCents < levelCents;
    const prev = points[i - 1];
    const prevBelow = prev ? prev.balanceCents < levelCents : false;
    if (below && !run) {
      run = prev ? [crossing(prev, p, levelCents), p] : [p];
    } else if (below) {
      run.push(p);
    } else if (run && prevBelow) {
      run.push(crossing(prev, p, levelCents));
      runs.push(run);
      run = null;
    }
  });
  if (run) runs.push(run);
  return runs;
}

export function chartModel(result) {
  if (!result) return null;
  const days = result.days || [];
  const events = (result.events || []).filter((e) => days.some((d) => d.date === e.date));
  const levelCents = result.warningLevelCents ?? 0;
  const points = buildPoints(days, events);
  const runs = belowRuns(points, levelCents);
  const belowSegments = runs.map((run) => [run[0].date, run[run.length - 1].date]);

  const markers = [...events]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => ({ date: parseDateOnly(e.date), label: eventLabel(e), kind: e.amountCents < 0 ? 'outflow' : 'inflow' }));

  const breach = result.breach || null;
  let headline = null;
  if (breach) {
    const what = breach.item ? breach.item.name : 'everyday spending';
    const date = parseDateOnly(breach.date);
    headline = `Short by ${money(breach.shortfallCents)} on ${formatDay(date)} (${what})`;
    markers.push({ date, label: `Short by ${money(breach.shortfallCents)}`, kind: 'breach' });
  }

  let lowest = null;
  if (result.lowest) {
    lowest = { date: parseDateOnly(result.lowest.date), balanceCents: result.lowest.balanceCents };
  } else if (points.length > 0) {
    const low = points.reduce((a, b) => (b.balanceCents < a.balanceCents ? b : a));
    lowest = { date: low.date, balanceCents: low.balanceCents };
  }

  return { points, belowSegments, belowRuns: runs, levelCents, markers, lowest, headline };
}
