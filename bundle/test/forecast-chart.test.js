import { chartModel } from '../src/insights-page/forecast-chart-data';
import ForecastChart from '../src/insights-page/ForecastChart.svelte';

const RED = '#ef4444';

// Local calendar date (never `new Date('YYYY-MM-DD')`, which is UTC).
const d = (iso, hours = 0) => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day, hours);
};
const iso = (n) => `2026-11-${String(n).padStart(2, '0')}`;

// Builds an AccountResult the way insights-api does: one day per date, the
// balance at the end of that day after the allowance and that day's events.
function makeResult({ startCents, allowancePerDayCents = 0, events = [], levelCents = 0, days = 15, breach = null, lowest = null }) {
  let bal = startCents;
  const series = [];
  for (let n = 1; n <= days; n++) {
    bal -= allowancePerDayCents;
    for (const e of events) if (e.date === iso(n)) bal += e.amountCents;
    series.push({ date: iso(n), balanceCents: bal });
  }
  const low = series.reduce((a, b) => (b.balanceCents < a.balanceCents ? b : a));
  return {
    accountId: 'a1',
    accountName: 'Checking',
    warningLevelCents: levelCents,
    balanceCents: startCents,
    allowancePerDayCents,
    allowanceNote: null,
    days: series,
    events,
    lowest: lowest ?? { date: low.date, balanceCents: low.balanceCents },
    breach,
  };
}

// The spec's example: start $2,500, Bills -$2,200 on 11-02, Payroll +$4,412
// on 11-06, Amex -$4,800 on 11-13, warning level $0.
function specExample() {
  return makeResult({
    startCents: 250000,
    events: [
      { date: '2026-11-02', name: 'Bills', amountCents: -220000 },
      { date: '2026-11-06', name: 'Payroll', amountCents: 441200 },
      { date: '2026-11-13', name: 'Amex', amountCents: -480000 },
    ],
    breach: { date: '2026-11-13', balanceCents: -8800, shortfallCents: 8800, item: { name: 'Amex', amountCents: -480000 } },
  });
}

function noBreach() {
  return makeResult({
    startCents: 500000,
    events: [{ date: '2026-11-05', name: 'Rent', amountCents: -100000 }],
  });
}

describe('chartModel', () => {
  test('the spec example: headline names the shortfall and the item', () => {
    const m = chartModel(specExample());
    expect(m.headline).toContain('Short by $88');
    expect(m.headline).toContain('(Amex)');
    expect(m.levelCents).toBe(0);
  });

  test('the spec example: a below-level segment starts on 11-13 (the Amex drop)', () => {
    const m = chartModel(specExample());
    expect(m.belowSegments).toHaveLength(1);
    expect(m.belowSegments[0][0].getTime()).toBe(d('2026-11-13').getTime());
    expect(m.belowSegments[0][1].getTime()).toBe(d('2026-11-15').getTime());
  });

  test('the spec example: event markers in order with kinds, plus a breach marker on 11-13', () => {
    const m = chartModel(specExample());
    const events = m.markers.filter((mk) => mk.kind !== 'breach');
    expect(events.map((mk) => mk.kind)).toEqual(['outflow', 'inflow', 'outflow']);
    expect(events[0].label).toContain('Bills');
    expect(events[0].label).toContain('$2,200');
    expect(events[1].label).toContain('Payroll');
    expect(events[1].label).toContain('$4,412');
    expect(events[2].label).toContain('Amex');
    expect(events.map((mk) => mk.date.getTime())).toEqual(
      [d('2026-11-02'), d('2026-11-06'), d('2026-11-13')].map((x) => x.getTime()),
    );
    const breach = m.markers.filter((mk) => mk.kind === 'breach');
    expect(breach).toHaveLength(1);
    expect(breach[0].date.getTime()).toBe(d('2026-11-13').getTime());
  });

  test('the spec example: lowest is the 11-13 balance, as a local Date', () => {
    const m = chartModel(specExample());
    expect(m.lowest.balanceCents).toBe(-8800);
    expect(m.lowest.date.getTime()).toBe(d('2026-11-13').getTime());
  });

  test('points are local Dates; an event day gets a vertical step (pre-event, then post-event)', () => {
    const m = chartModel(specExample());
    expect(m.points[0].date.getTime()).toBe(d('2026-11-01').getTime());
    expect(m.points[0].balanceCents).toBe(250000);
    const on13 = m.points.filter((p) => p.date.getTime() === d('2026-11-13').getTime());
    expect(on13.map((p) => p.balanceCents)).toEqual([471200, -8800]);
    // Strictly time-ordered (non-decreasing).
    for (let i = 1; i < m.points.length; i++) {
      expect(m.points[i].date.getTime()).toBeGreaterThanOrEqual(m.points[i - 1].date.getTime());
    }
  });

  test('a breach with no item names everyday spending', () => {
    const r = makeResult({ startCents: 3000, allowancePerDayCents: 1000, days: 5 });
    r.breach = { date: '2026-11-04', balanceCents: -1000, shortfallCents: 1000, item: null };
    expect(chartModel(r).headline).toContain('(everyday spending)');
  });

  test('no breach: headline null, no below segments, no breach marker', () => {
    const m = chartModel(noBreach());
    expect(m.headline).toBeNull();
    expect(m.belowSegments).toEqual([]);
    expect(m.markers.some((mk) => mk.kind === 'breach')).toBe(false);
  });

  test('a level above zero is carried as levelCents', () => {
    const r = noBreach();
    r.warningLevelCents = 50000;
    expect(chartModel(r).levelCents).toBe(50000);
  });

  test('a dip below the level and back has boundaries at the interpolated crossings', () => {
    // Level $0; 11-01 +$10, 11-02 -$10 (allowance-only slope), 11-03 +$10.
    const r = makeResult({ startCents: 0, days: 3 });
    r.days = [
      { date: '2026-11-01', balanceCents: 1000 },
      { date: '2026-11-02', balanceCents: -1000 },
      { date: '2026-11-03', balanceCents: 1000 },
    ];
    r.lowest = { date: '2026-11-02', balanceCents: -1000 };
    r.breach = { date: '2026-11-02', balanceCents: -1000, shortfallCents: 1000, item: null };
    const m = chartModel(r);
    expect(m.belowSegments).toHaveLength(1);
    const [start, end] = m.belowSegments[0];
    // Halfway between days (DST-safe: compare to the midpoint of the two dates).
    const mid = (a, b) => (d(a).getTime() + d(b).getTime()) / 2;
    expect(start.getTime()).toBe(mid('2026-11-01', '2026-11-02'));
    expect(end.getTime()).toBe(mid('2026-11-02', '2026-11-03'));
  });

  test('a series that starts below the level begins its segment at the first day', () => {
    const r = makeResult({ startCents: -500, allowancePerDayCents: 0, days: 3 });
    const m = chartModel(r);
    expect(m.belowSegments).toHaveLength(1);
    expect(m.belowSegments[0][0].getTime()).toBe(d('2026-11-01').getTime());
  });

  test('long event names are truncated in marker labels', () => {
    const r = makeResult({
      startCents: 500000,
      events: [{ date: '2026-11-03', name: 'A very long scheduled transaction name indeed', amountCents: -1000 }],
    });
    const label = chartModel(r).markers[0].label;
    expect(label).toContain('…');
    expect(label.length).toBeLessThan(35);
  });

  test('dates are parsed as local days, not UTC', () => {
    const m = chartModel(specExample());
    expect(m.points[0].date.getDate()).toBe(1);
    expect(m.points[0].date.getHours()).toBe(0);
  });
});

function mountChart(props) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new ForecastChart({ target, props });
  return target;
}

describe('ForecastChart', () => {
  test('renders an svg with a dashed level line, the headline and the lowest balance', () => {
    const host = mountChart({ result: specExample() });
    const svg = host.querySelector('svg');
    expect(svg).not.toBeNull();
    const level = svg.querySelector('.forecast-level-line');
    expect(level).not.toBeNull();
    expect(level.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(svg.textContent).toContain('Warning level $0');
    const headline = host.querySelector('.forecast-headline');
    expect(headline.textContent).toContain('Short by $88');
    expect(headline.textContent).toContain('Amex');
    expect(host.querySelector('.forecast-lowest').textContent).toContain('Lowest balance');
    expect(host.querySelector('.forecast-lowest').textContent).toContain('-$88');
  });

  test('draws the balance line, the red below-level area, event markers and a red breach marker', () => {
    const host = mountChart({ result: specExample() });
    expect(host.querySelector('.forecast-balance-line').getAttribute('d')).toMatch(/^M/);
    const below = host.querySelectorAll('.forecast-below-area');
    expect(below).toHaveLength(1);
    expect(below[0].getAttribute('fill')).toBe(RED);
    expect(host.querySelectorAll('.forecast-event-marker')).toHaveLength(3);
    expect(host.querySelector('svg').textContent).toContain('Payroll');
    expect(host.querySelector('.forecast-breach-marker').getAttribute('fill')).toBe(RED);
    expect(host.querySelectorAll('.forecast-axis-label--x').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.forecast-axis-label--y').length).toBeGreaterThan(0);
  });

  test('with no breach: no red area, no headline, lowest balance still shown', () => {
    const host = mountChart({ result: noBreach() });
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.forecast-below-area')).toBeNull();
    expect(host.querySelector('.forecast-breach-marker')).toBeNull();
    expect(host.querySelector('.forecast-headline')).toBeNull();
    expect(host.querySelector('.forecast-lowest').textContent).toContain('$4,000');
  });

  test('a level above zero is labelled with its amount', () => {
    const r = noBreach();
    r.warningLevelCents = 50000;
    const host = mountChart({ result: r });
    expect(host.querySelector('svg').textContent).toContain('Warning level $500');
  });

  test('a level, shortfall or lowest with cents shows the cents; whole dollars stay whole', () => {
    const r = makeResult({
      startCents: 10000,
      events: [{ date: '2026-11-03', name: 'Phone', amountCents: -8051 }],
      levelCents: 1999,
      breach: { date: '2026-11-03', balanceCents: 1949, shortfallCents: 50, item: { name: 'Phone', amountCents: -8051 } },
    });
    const host = mountChart({ result: r });
    expect(host.querySelector('svg').textContent).toContain('Warning level $19.99');
    expect(host.querySelector('.forecast-headline').textContent).toContain('Short by $0.50');
    expect(chartModel(r).markers.find((m) => m.kind === 'breach').label).toBe('Short by $0.50');
    expect(host.querySelector('.forecast-lowest').textContent).toContain('$19.49');
    expect(chartModel(specExample()).headline).toContain('Short by $88 ');
  });

  test('no result renders nothing', () => {
    const host = mountChart({ result: null });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.textContent.trim()).toBe('');
  });
});
