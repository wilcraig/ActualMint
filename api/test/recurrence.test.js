const { resolveScheduledAmount, expandOccurrences } = require('../src/recurrence');

test('resolveScheduledAmount passes a plain number through unchanged', () => {
  expect(resolveScheduledAmount(5000)).toBe(5000);
});

test('resolveScheduledAmount averages a {num1, num2} range and rounds', () => {
  expect(resolveScheduledAmount({ num1: 100, num2: 101 })).toBe(101); // (100+101)/2 = 100.5 -> rounds to 101
});

test("expandOccurrences finds a biweekly schedule's occurrences within a date range", () => {
  const config = { frequency: 'weekly', interval: 2, start: '2026-11-06' };
  const dates = expandOccurrences(config, { start: new Date('2026-11-01'), end: new Date('2026-11-30') });
  expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-06', '2026-11-20']);
});

test('expandOccurrences returns an empty array for a schedule with no occurrences in range', () => {
  const config = { frequency: 'monthly', start: '2020-01-01', endMode: 'on_date', endDate: '2020-12-31' };
  const dates = expandOccurrences(config, { start: new Date('2026-11-01'), end: new Date('2026-11-30') });
  expect(dates).toEqual([]);
});

test('expandOccurrences shifts a weekend occurrence per skipWeekend/weekendSolveMode', () => {
  // 2026-11-07 is a Saturday. With skipWeekend + weekendSolveMode 'before', it should shift to
  // the preceding Friday, 2026-11-06.
  const config = {
    frequency: 'weekly',
    start: '2026-11-07',
    skipWeekend: true,
    weekendSolveMode: 'before',
  };
  const dates = expandOccurrences(config, { start: new Date('2026-11-01'), end: new Date('2026-11-08') });
  expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-06']);
});

test('expandOccurrences handles a monthly schedule with a day-of-month pattern', () => {
  const config = { frequency: 'monthly', start: '2026-01-15', patterns: [{ type: 'day', value: 15 }] };
  const dates = expandOccurrences(config, { start: new Date('2026-11-01'), end: new Date('2026-11-30') });
  expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-15']);
});

test("expandOccurrences shifts a weekend occurrence into the PRIOR month's range when weekendSolveMode is 'before' (final-review Fix 3)", () => {
  // 2026-11-01 is a Sunday. The natural (unshifted) occurrence falls in
  // November, but weekendSolveMode 'before' shifts it back to the preceding
  // Friday, 2026-10-30 — so it should show up when querying OCTOBER's range,
  // not November's, even though October's range itself never naturally
  // contained Nov 1.
  const config = {
    frequency: 'monthly',
    start: '2026-11-01',
    patterns: [{ type: 'day', value: 1 }],
    skipWeekend: true,
    weekendSolveMode: 'before',
  };

  const octoberRange = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59, 999) };
  const octoberDates = expandOccurrences(config, octoberRange);
  expect(octoberDates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-30']);

  // It must NOT also appear in November's range (that would double count it).
  const novemberRange = { start: new Date(2026, 10, 1), end: new Date(2026, 10, 30, 23, 59, 59, 999) };
  const novemberDates = expandOccurrences(config, novemberRange);
  expect(novemberDates).toEqual([]);
});

test('expandOccurrences handles a monthly schedule with a day-of-week pattern (nth weekday)', () => {
  // "Every 2nd Tuesday" of the month. Nov 2026: Tuesdays are 3, 10, 17, 24 -> 2nd Tuesday is Nov 10.
  const config = {
    frequency: 'monthly',
    start: '2026-01-01',
    patterns: [{ type: 'TU', value: 2 }],
  };
  const dates = expandOccurrences(config, { start: new Date('2026-11-01'), end: new Date('2026-11-30') });
  expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-11-10']);
});
