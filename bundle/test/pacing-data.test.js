import { computeBarState } from '../src/widgets/pacing-data';

test('budgeted: 0 never produces NaN or Infinity', () => {
  const r = computeBarState({ budgeted: 0, spent: 500 }, { daysElapsed: 10, daysInMonth: 30 });
  expect(r.fillPct).toBe(0);
  expect(Number.isFinite(r.fillPct)).toBe(true);
});

test('over budget is flagged and fill is capped at 100', () => {
  const r = computeBarState({ budgeted: 10000, spent: 15000 }, { daysElapsed: 10, daysInMonth: 30 });
  expect(r.status).toBe('over');
  expect(r.fillPct).toBe(100);
});

test('tick position reflects elapsed days', () => {
  const r = computeBarState({ budgeted: 10000, spent: 4000 }, { daysElapsed: 15, daysInMonth: 30 });
  expect(r.tickPct).toBe(50);
});

test('$40 spent on a $100 budget shows under, 40% fill, non-negative', () => {
  const r = computeBarState({ budgeted: 10000, spent: 4000 }, { daysElapsed: 15, daysInMonth: 30 });
  expect(r.fillPct).toBe(40);
  expect(r.status).toBe('under');
});

test('a refund-heavy category (negative spent = net inflow) clamps fill to 0, not negative', () => {
  const r = computeBarState({ budgeted: 10000, spent: -2000 }, { daysElapsed: 15, daysInMonth: 30 });
  expect(r.fillPct).toBe(0);
  expect(r.fillPct).toBeGreaterThanOrEqual(0);
  expect(r.status).toBe('under');
});
