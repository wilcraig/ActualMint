import { computeBarState, collectCategoryIds, buildPacingRows } from '../src/widgets/pacing-data';

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

describe('collectCategoryIds', () => {
  test('returns plain category id strings unchanged', () => {
    expect(collectCategoryIds(['catA', 'catB'])).toEqual(['catA', 'catB']);
  });

  test('flattens a rollup\'s budgets list in alongside plain ids', () => {
    const ids = collectCategoryIds(['catA', { title: 'Elizabeth Personal Care', budgets: ['catB', 'catC'] }]);
    expect(ids).toEqual(['catA', 'catB', 'catC']);
  });

  test('dedupes an id that appears both standalone and inside a rollup', () => {
    const ids = collectCategoryIds(['catA', { title: 'Rollup', budgets: ['catA', 'catB'] }]);
    expect(ids).toEqual(['catA', 'catB']);
  });
});

describe('buildPacingRows', () => {
  const CATEGORIES = [
    { id: 'catA', name: 'Hair', groupId: 'g1', groupName: 'Personal Care', spent: 4000, balance: 6000 },
    { id: 'catB', name: 'Spa', groupId: 'g1', groupName: 'Personal Care', spent: 1000, balance: -1000 },
    { id: 'catC', name: 'Skincare', groupId: 'g1', groupName: 'Personal Care', spent: 500, balance: 500 },
  ];

  test('a plain category id becomes its own row with rollover-aware budgeted (balance + spent)', () => {
    const rows = buildPacingRows(['catA'], CATEGORIES);
    expect(rows).toEqual([
      { kind: 'category', id: 'catA', name: 'Hair', groupId: 'g1', groupName: 'Personal Care', spent: 4000, budgeted: 10000 },
    ]);
  });

  test('a rollup sums spent and rollover-aware budgeted across its member categories', () => {
    const rows = buildPacingRows([{ title: 'Elizabeth Personal Care', budgets: ['catA', 'catB', 'catC'] }], CATEGORIES);
    // spent: 4000+1000+500=5500; budgeted (balance+spent per member): (6000+4000)+(-1000+1000)+(500+500)=10000+0+1000=11000
    expect(rows).toEqual([{ kind: 'rollup', id: 'rollup:Elizabeth Personal Care', name: 'Elizabeth Personal Care', spent: 5500, budgeted: 11000 }]);
  });

  test('a rollup with some members missing from the API response sums only the present ones', () => {
    const rows = buildPacingRows([{ title: 'Partial', budgets: ['catA', 'does-not-exist'] }], CATEGORIES);
    expect(rows).toEqual([{ kind: 'rollup', id: 'rollup:Partial', name: 'Partial', spent: 4000, budgeted: 10000 }]);
  });

  test('a rollup with no resolvable members is omitted rather than shown as an empty bar', () => {
    const rows = buildPacingRows([{ title: 'All Missing', budgets: ['does-not-exist'] }], CATEGORIES);
    expect(rows).toEqual([]);
  });

  test('preserves the order of mixed plain ids and rollups as given', () => {
    const rows = buildPacingRows(['catC', { title: 'Rollup', budgets: ['catA', 'catB'] }, 'catA'], CATEGORIES);
    expect(rows.map((r) => r.id)).toEqual(['catC', 'rollup:Rollup', 'catA']);
  });

  test('a malformed item (neither a string nor a well-formed rollup) is skipped, not thrown', () => {
    const rows = buildPacingRows(['catA', { oops: true }, null, 42], CATEGORIES);
    expect(rows.map((r) => r.id)).toEqual(['catA']);
  });
});
