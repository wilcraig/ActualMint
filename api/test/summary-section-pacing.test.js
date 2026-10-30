const { buildContext } = require('../src/summary/context');
const { defaultSettings } = require('../src/summary/settings-store');
const { SECTIONS, getSection } = require('../src/summary/sections');
const { formatMoney } = require('../src/summary/format');

const pacing = getSection('pacing');

// Actual's shape: spent is negative for outflow; balance is what's left
// (carryover included). available = balance + spent (positive spent).
const cat = (id, name, { budgeted = 0, spent = 0, balance } = {}) => ({
  id,
  name,
  budgeted,
  spent: -spent,
  balance: balance ?? budgeted - spent,
});

function groups(overrides = {}) {
  return [
    {
      id: 'g-food',
      name: 'Food',
      categories: [
        overrides.groc || cat('c-groc', 'Groceries', { budgeted: 60000, spent: 30000 }),
        overrides.dining || cat('c-dining', 'Dining', { budgeted: 20000, spent: 10000 }),
      ],
    },
    { id: 'g-home', name: 'Home', categories: [overrides.mortgage || cat('c-mortgage', 'Mortgage', { budgeted: 200000, spent: 200000 })] },
    { id: 'g-inc', name: 'Income', is_income: true, categories: [cat('c-pay', 'Paycheck', { spent: -500000 })] },
    { id: 'g-xfer', name: 'Transfers', categories: [cat('c-xfer', 'To savings', { budgeted: 0, spent: 90000 })] },
  ];
}

async function run({ now = new Date(2026, 9, 15, 7), budgetGroups = groups(), mutate = () => {} } = {}) {
  const settings = defaultSettings();
  settings.exclusions.categoryIds = ['c-mortgage'];
  mutate(settings);
  const client = {
    getCategoryGroups: jest.fn(async () => budgetGroups.map(({ id, name, is_income, categories }) => ({ id, name, is_income, categories: categories.map(({ id: cid, name: cname }) => ({ id: cid, name: cname })) }))),
    getBudgetMonth: jest.fn(async () => ({ categoryGroups: budgetGroups })),
  };
  const ctx = await buildContext({ client, now, period: { kind: 'week', start: '2026-10-08', end: '2026-10-14' }, settings, delivery: { id: 'd1' } });
  const result = await pacing.build(ctx);
  return { result, client };
}

test('formatMoney', () => {
  expect(formatMoney(123456)).toBe('$1,234.56');
  expect(formatMoney(5)).toBe('$0.05');
  expect(formatMoney(-81200)).toBe('-$812.00');
  expect(formatMoney(0)).toBe('$0.00');
});

test('registry lists sections in display order and finds them by id', () => {
  expect(SECTIONS[0].id).toBe('pacing');
  expect(getSection('pacing').title).toBe('Pacing');
  expect(getSection('nope')).toBeUndefined();
});

test('reads the current month from getBudgetMonth', async () => {
  const { client } = await run();
  expect(client.getBudgetMonth).toHaveBeenCalledWith('2026-10');
});

test('on pace: half the month gone, half spent', async () => {
  // Oct 15 of 31 days: fraction 15/31.
  const { result } = await run({
    budgetGroups: groups({
      groc: cat('c-groc', 'Groceries', { budgeted: 62000, spent: 30000 }),
      dining: cat('c-dining', 'Dining', { budgeted: 31000, spent: 15000 }),
    }),
  });
  const { overall } = result.data;
  expect(overall.spentCents).toBe(45000);
  expect(overall.availableCents).toBe(93000);
  expect(overall.expectedCents).toBe(45000);
  expect(overall.fractionElapsed).toBeCloseTo(15 / 31);
  expect(overall.status).toBe('on-pace');
  expect(result.data.offTrack).toEqual([]);
  expect(result.lines[0]).toBe('On track: $450.00 spent, $450.00 expected by today');
});

test('off track beyond the 10% tolerance, within it is still on pace', async () => {
  // Groceries expected 31000 by the 15th; 34000 is 9.7% over (on pace),
  // Dining expected 15500; 17100 is 10.3% over (off track).
  const { result } = await run({
    budgetGroups: groups({
      groc: cat('c-groc', 'Groceries', { budgeted: 64133, spent: 34000 }),
      dining: cat('c-dining', 'Dining', { budgeted: 32033, spent: 17100 }),
    }),
  });
  expect(result.data.offTrack.map((l) => l.categoryId)).toEqual(['c-dining']);
  expect(result.data.offTrack[0]).toMatchObject({ name: 'Dining', groupName: 'Food', status: 'off-track', spentCents: 17100 });
  expect(result.lines.some((l) => l.startsWith('Dining:'))).toBe(true);
});

test('tolerance setting is respected', async () => {
  const budgetGroups = groups({
    groc: cat('c-groc', 'Groceries', { budgeted: 64133, spent: 34000 }),
    dining: cat('c-dining', 'Dining', { budgeted: 32033, spent: 15000 }),
  });
  const { result } = await run({ budgetGroups, mutate: (s) => { s.sections.pacing.tolerancePct = 0; } });
  expect(result.data.offTrack.map((l) => l.categoryId)).toEqual(['c-groc']);
});

test('over budget when spent passes everything available', async () => {
  const { result } = await run({ budgetGroups: groups({ dining: cat('c-dining', 'Dining', { budgeted: 10000, spent: 12000 }) }) });
  expect(result.data.offTrack[0]).toMatchObject({ categoryId: 'c-dining', status: 'over' });
});

test('carryover counts: available is balance + spent, not budgeted', async () => {
  // Budgeted 100 but 500 carried in: balance = 600 - 200 = 400, available 600.
  const { result } = await run({
    budgetGroups: groups({ dining: cat('c-dining', 'Dining', { budgeted: 10000, spent: 20000, balance: 40000 }) }),
  });
  expect(result.data.offTrack.find((l) => l.categoryId === 'c-dining')).toBeUndefined();
  const food = result.data.groups.find((g) => g.groupName === 'Food');
  expect(food.availableCents).toBe(60000 + 60000);
});

test('excluded, income and Transfers categories are ignored', async () => {
  const { result } = await run();
  expect(result.data.overall.spentCents).toBe(40000);
  expect(result.data.groups.map((g) => g.groupName)).toEqual(['Food']);
  expect(JSON.stringify(result.data)).not.toMatch(/Mortgage|Paycheck|To savings/);
});

test('categoryIds restricts which categories count', async () => {
  const { result } = await run({ mutate: (s) => { s.sections.pacing.categoryIds = ['c-dining', 'c-mortgage']; } });
  expect(result.data.overall.spentCents).toBe(10000);
});

test('day 1 with zero budgets: nothing flagged, no NaN', async () => {
  const { result } = await run({
    now: new Date(2026, 10, 1, 6),
    budgetGroups: groups({
      groc: cat('c-groc', 'Groceries', { budgeted: 0, spent: 0 }),
      dining: cat('c-dining', 'Dining', { budgeted: 0, spent: 0 }),
    }),
  });
  expect(result.data.offTrack).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/NaN|null|Infinity/);
  expect(result.data.overall.fractionElapsed).toBeCloseTo(1 / 30);
});

test('day 1 with budgets and a little spending is not flagged wholesale', async () => {
  const { result } = await run({
    now: new Date(2026, 10, 1, 6),
    budgetGroups: groups({
      groc: cat('c-groc', 'Groceries', { budgeted: 60000, spent: 1500 }),
      dining: cat('c-dining', 'Dining', { budgeted: 20000, spent: 0 }),
    }),
  });
  expect(result.data.offTrack).toEqual([]);
});

test('refund-heavy category with negative spent does not break totals', async () => {
  const { result } = await run({ budgetGroups: groups({ dining: cat('c-dining', 'Dining', { budgeted: 20000, spent: -5000 }) }) });
  expect(result.data.overall.spentCents).toBe(25000);
  expect(Number.isFinite(result.data.overall.expectedCents)).toBe(true);
  expect(result.data.offTrack).toEqual([]);
});

test('off-track lines are sorted by overage and capped at 5 in the text', async () => {
  const many = Array.from({ length: 7 }, (_, i) => cat(`c-${i}`, `Cat ${i}`, { budgeted: 10000, spent: 11000 + i * 1000 }));
  const { result } = await run({ budgetGroups: [{ id: 'g-x', name: 'Misc', categories: many }] });
  expect(result.data.offTrack.map((l) => l.categoryId)).toEqual(['c-6', 'c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0']);
  expect(result.lines).toHaveLength(6);
  expect(result.lines[0]).toMatch(/^Over budget: /);
});
