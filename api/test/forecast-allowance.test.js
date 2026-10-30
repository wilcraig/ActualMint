const { computeAllowance } = require('../src/forecast/allowance');

const TODAY = '2026-10-30';
const NOTE = 'Not enough history for an everyday-spending allowance (needs 4 weeks).';

function daysAgo(n) {
  const d = new Date(2026, 9, 30 - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// One outflow per week; week k's transaction sits 7k+1 days back (week start edge, inside the week).
const weekly = (cents, extra = {}) =>
  cents.map((c, k) => ({ date: daysAgo(7 * k + 3), amount: -c, payee: 'p1', ...extra }));

const oldest = (n) => ({ date: daysAgo(n), amount: 100000, payee: null });
const run = (txns, excludedPayeeIds = new Set()) => computeAllowance(txns, { excludedPayeeIds, today: TODAY });

test('median of 8 weeks ignores an outlier week', () => {
  const txns = [oldest(84), ...weekly([0, 100, 200, 300, 400, 500, 600, 99999])];
  expect(run(txns)).toEqual({ perDayCents: 50, weeksUsed: 8, note: null });
});

test('transfers, excluded payees and deposits are not counted', () => {
  const txns = [
    oldest(84),
    ...weekly([700, 700, 700, 700, 700, 700, 700, 700]),
    { date: daysAgo(2), amount: -50000, payee: 'p1', transfer_id: 't1' },
    { date: daysAgo(2), amount: -50000, payee: 'skip' },
    { date: daysAgo(2), amount: 50000, payee: 'p1' },
  ];
  expect(run(txns, new Set(['skip']))).toMatchObject({ perDayCents: 100, weeksUsed: 8 });
});

test('a zero-spend week lowers the median', () => {
  const txns = [oldest(56), ...weekly([0, 0, 0, 0, 500, 500, 500, 500])];
  expect(run(txns)).toEqual({ perDayCents: Math.round(250 / 7), weeksUsed: 8, note: null });
});

test('under 4 weeks of history returns zero with a note', () => {
  expect(run([oldest(20), ...weekly([700, 700])])).toEqual({ perDayCents: 0, weeksUsed: 2, note: NOTE });
});

test('exactly 28 days of history uses 4 weeks', () => {
  const txns = [oldest(28), ...weekly([700, 700, 700, 700])];
  expect(run(txns)).toEqual({ perDayCents: 100, weeksUsed: 4, note: null });
});

test('27 days of history is still under 4 weeks', () => {
  expect(run([oldest(27), ...weekly([700, 700, 700])])).toEqual({ perDayCents: 0, weeksUsed: 3, note: NOTE });
});

test('empty list returns zero with a note', () => {
  expect(run([])).toEqual({ perDayCents: 0, weeksUsed: 0, note: NOTE });
});
