const { buildContext } = require('../src/summary/context');
const { defaultSettings } = require('../src/summary/settings-store');
const { isIncomeGroup, isTransferGroup } = require('../src/cash-flow-data');

const CATEGORY_GROUPS = [
  { id: 'g-food', name: 'Food', categories: [{ id: 'c-groc', name: 'Groceries' }, { id: 'c-dining', name: 'Dining' }] },
  { id: 'g-home', name: 'Home', categories: [{ id: 'c-mortgage', name: 'Mortgage' }] },
  { id: 'g-inc', name: 'Income', is_income: true, categories: [{ id: 'c-start', name: 'Starting Balances' }] },
  { id: 'g-pinc', name: 'Personal Income', categories: [{ id: 'c-pay', name: 'Paycheck' }] },
  { id: 'g-xfer', name: 'Transfers', categories: [{ id: 'c-xfer', name: 'To savings' }] },
];

function stubClient() {
  return { getCategoryGroups: jest.fn(async () => CATEGORY_GROUPS) };
}

async function context({ now = new Date(2026, 9, 29, 7), mutate = () => {} } = {}) {
  const settings = defaultSettings();
  settings.exclusions.categoryIds = ['c-mortgage'];
  settings.exclusions.payeeIds = ['p-landlord'];
  settings.exclusions.scheduleIds = ['s-mortgage'];
  mutate(settings);
  return buildContext({
    client: stubClient(),
    now,
    period: { kind: 'week', start: '2026-10-22', end: '2026-10-28' },
    settings,
    delivery: { id: 'd1', name: 'Weekly' },
    reportedIds: new Set(['t1']),
  });
}

test('cash-flow-data exports the shared group predicates', () => {
  expect(isIncomeGroup({ name: 'Personal Income' })).toBe(true);
  expect(isIncomeGroup({ name: 'Bills', is_income: true })).toBe(true);
  expect(isIncomeGroup({ name: 'Bills' })).toBe(false);
  expect(isTransferGroup({ name: ' Transfers ' })).toBe(true);
  expect(isTransferGroup({ name: 'Transfer fees' })).toBe(false);
});

test('month bounds and days come from now', async () => {
  const ctx = await context();
  expect(ctx.month).toBe('2026-10');
  expect(ctx.monthStart).toBe('2026-10-01');
  expect(ctx.monthEnd).toBe('2026-10-31');
  expect(ctx.daysElapsed).toBe(29);
  expect(ctx.daysInMonth).toBe(31);
});

test('daysElapsed counts today, so the 1st is day 1', async () => {
  const ctx = await context({ now: new Date(2026, 1, 1, 0, 5) });
  expect(ctx.daysElapsed).toBe(1);
  expect(ctx.daysInMonth).toBe(28);
  expect(ctx.month).toBe('2026-02');
});

test('income groups, by flag or by name, are flagged and not counted', async () => {
  const ctx = await context();
  expect(ctx.categories.get('c-start')).toMatchObject({ isIncome: true, groupName: 'Income' });
  expect(ctx.categories.get('c-pay')).toMatchObject({ isIncome: true, groupName: 'Personal Income' });
  expect(ctx.isCountedCategory('c-start')).toBe(false);
  expect(ctx.isCountedCategory('c-pay')).toBe(false);
});

test('the Transfers group is flagged and not counted', async () => {
  const ctx = await context();
  expect(ctx.categories.get('c-xfer')).toMatchObject({ isTransfer: true, isIncome: false });
  expect(ctx.isCountedCategory('c-xfer')).toBe(false);
});

test('an excluded category is marked excluded and not counted', async () => {
  const ctx = await context();
  expect(ctx.categories.get('c-mortgage')).toEqual({
    id: 'c-mortgage',
    name: 'Mortgage',
    groupId: 'g-home',
    groupName: 'Home',
    isIncome: false,
    isTransfer: false,
    excluded: true,
  });
  expect(ctx.isCountedCategory('c-mortgage')).toBe(false);
  expect(ctx.isCountedCategory('c-groc')).toBe(true);
});

test('an unknown or missing category is not counted', async () => {
  const ctx = await context();
  expect(ctx.isCountedCategory('c-gone')).toBe(false);
  expect(ctx.isCountedCategory(null)).toBe(false);
});

test('excluded payees and schedules', async () => {
  const ctx = await context();
  expect(ctx.isExcludedPayee('p-landlord')).toBe(true);
  expect(ctx.isExcludedPayee('p-grocer')).toBe(false);
  expect(ctx.isExcludedSchedule('s-mortgage')).toBe(true);
  expect(ctx.isExcludedSchedule('s-gym')).toBe(false);
});

test('passes through period, settings, delivery and reported ids', async () => {
  const ctx = await context();
  expect(ctx.period.kind).toBe('week');
  expect(ctx.delivery.id).toBe('d1');
  expect(ctx.reportedIds.has('t1')).toBe(true);
  expect(ctx.settings.sections.largest.count).toBe(5);
  expect(typeof ctx.client.getCategoryGroups).toBe('function');
});
