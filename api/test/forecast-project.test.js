const { projectAccount } = require('../src/forecast/project');

const TODAY = '2026-10-30';
const run = (over) =>
  projectAccount({
    balanceCents: 0,
    occurrences: [],
    allowancePerDayCents: 0,
    warningLevelCents: 0,
    today: TODAY,
    windowDays: 15,
    ...over,
  });
const ev = (name, date, amountCents) => ({ name, date, amountCents });

test('no events: flat balance, no breach, lowest is day 0', () => {
  const p = run({ balanceCents: 1000 });
  expect(p.days).toHaveLength(16);
  expect(p.days[0]).toEqual({ date: '2026-10-30', balanceCents: 1000 });
  expect(p.days[15]).toEqual({ date: '2026-11-14', balanceCents: 1000 });
  expect(p.breach).toBeNull();
  expect(p.lowest).toEqual({ date: '2026-10-30', balanceCents: 1000 });
  expect(p.events).toEqual([]);
});

test('bills and payroll then Amex breach on 11-13', () => {
  const p = run({
    balanceCents: 2500,
    occurrences: [ev('Bills', '2026-11-02', -2200), ev('Payroll', '2026-11-06', 4412), ev('Amex', '2026-11-13', -4800)],
  });
  expect(p.breach).toEqual({
    date: '2026-11-13',
    balanceCents: -88,
    shortfallCents: 88,
    item: { name: 'Amex', amountCents: -4800 },
  });
  expect(p.lowest).toEqual({ date: '2026-11-13', balanceCents: -88 });
  expect(p.events.map((e) => e.date)).toEqual(['2026-11-02', '2026-11-06', '2026-11-13']);
});

test('two outflows on the crossing day: item is the larger', () => {
  const p = run({
    balanceCents: 1000,
    occurrences: [ev('Small', '2026-11-01', -600), ev('Big', '2026-11-01', -900), ev('Pay', '2026-11-01', 100)],
  });
  expect(p.breach.date).toBe('2026-11-01');
  expect(p.breach.item).toEqual({ name: 'Big', amountCents: -900 });
});

test('start balance below level breaches today', () => {
  const p = run({ balanceCents: -5 });
  expect(p.breach.date).toBe('2026-10-30');
  expect(p.breach.shortfallCents).toBe(5);
  expect(p.breach.item).toBeNull();
});

test('allowance alone crosses 0 on 11-02 with item null', () => {
  const p = run({ balanceCents: 250, allowancePerDayCents: 100 });
  expect(p.days.slice(0, 4).map((d) => d.balanceCents)).toEqual([250, 150, 50, -50]);
  expect(p.breach).toEqual({ date: '2026-11-02', balanceCents: -50, shortfallCents: 50, item: null });
});

test('balance exactly at warning level is not a breach', () => {
  expect(run({ balanceCents: 5000, warningLevelCents: 5000 }).breach).toBeNull();
});

test('events outside the window are ignored', () => {
  const p = run({
    balanceCents: 100,
    occurrences: [ev('Late', '2026-11-15', -5000), ev('Past', '2026-10-29', -5000)],
  });
  expect(p.events).toEqual([]);
  expect(p.breach).toBeNull();
});

test('an overdue item dated today counts on day 0', () => {
  const p = run({ balanceCents: 100, occurrences: [ev('Overdue', '2026-10-30', -300)] });
  expect(p.days[0].balanceCents).toBe(-200);
  expect(p.breach.date).toBe('2026-10-30');
  expect(p.breach.item).toEqual({ name: 'Overdue', amountCents: -300 });
});
