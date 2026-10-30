const { resolvePeriod, formatDay } = require('../src/summary/period');

// Local-time dates: the resolver works in the process TZ, like month-days.js.
const at = (y, m, d, h = 7) => new Date(y, m - 1, d, h, 0);

test('yesterday is the single day before now', () => {
  expect(resolvePeriod('yesterday', at(2026, 10, 29))).toEqual({ kind: 'yesterday', start: '2026-10-28', end: '2026-10-28' });
});

test('yesterday on the 1st is the last day of the previous month', () => {
  expect(resolvePeriod('yesterday', at(2026, 3, 1))).toEqual({ kind: 'yesterday', start: '2026-02-28', end: '2026-02-28' });
});

test('week is the 7 days ending yesterday', () => {
  expect(resolvePeriod('week', at(2026, 10, 29))).toEqual({ kind: 'week', start: '2026-10-22', end: '2026-10-28' });
});

test('week spans a month boundary', () => {
  expect(resolvePeriod('week', at(2026, 11, 3))).toEqual({ kind: 'week', start: '2026-10-27', end: '2026-11-02' });
});

test('week spans a year boundary', () => {
  expect(resolvePeriod('week', at(2027, 1, 2))).toEqual({ kind: 'week', start: '2026-12-26', end: '2027-01-01' });
});

test('since-last runs from the day of the last send through yesterday', () => {
  const last = new Date(2026, 9, 25, 6, 30);
  expect(resolvePeriod('since-last', at(2026, 10, 29), last)).toEqual({ kind: 'since-last', start: '2026-10-25', end: '2026-10-28' });
});

test('since-last with no previous send covers the last 7 days', () => {
  expect(resolvePeriod('since-last', at(2026, 10, 29), null)).toEqual({ kind: 'since-last', start: '2026-10-22', end: '2026-10-28' });
  expect(resolvePeriod('since-last', at(2026, 10, 29))).toEqual({ kind: 'since-last', start: '2026-10-22', end: '2026-10-28' });
});

test('since-last sent earlier today never produces an empty range', () => {
  const last = new Date(2026, 9, 29, 6, 0);
  const period = resolvePeriod('since-last', at(2026, 10, 29, 18), last);
  expect(period.start <= period.end).toBe(true);
  expect(period.end).toBe('2026-10-28');
});

test('month-to-date runs from the 1st through yesterday and highlights the last 7 days', () => {
  expect(resolvePeriod('month-to-date', at(2026, 10, 29))).toEqual({
    kind: 'month-to-date',
    start: '2026-10-01',
    end: '2026-10-28',
    highlightStart: '2026-10-22',
  });
});

test('month-to-date on the 1st covers today so the range is never empty', () => {
  expect(resolvePeriod('month-to-date', at(2026, 11, 1))).toEqual({
    kind: 'month-to-date',
    start: '2026-11-01',
    end: '2026-11-01',
    highlightStart: '2026-10-26',
  });
});

test('unknown kind throws', () => {
  expect(() => resolvePeriod('fortnight', at(2026, 10, 29))).toThrow(/unknown period/);
});

test('formatDay pads month and day', () => {
  expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05');
});
