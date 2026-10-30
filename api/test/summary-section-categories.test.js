const { buildContext } = require('../src/summary/context');
const { defaultSettings } = require('../src/summary/settings-store');
const { SECTIONS, getSection } = require('../src/summary/sections');

const cat = (id, name, { budgeted = 0, spent = 0, balance } = {}) => ({ id, name, budgeted, spent: -spent, balance: balance ?? budgeted - spent });

const BUDGET_GROUPS = [
  {
    id: 'g-food',
    name: 'Food',
    categories: [
      cat('c-groc', 'Groceries', { budgeted: 60000, spent: 20000 }), // under
      cat('c-dining', 'Dining', { budgeted: 10000, spent: 12500 }), // over
    ],
  },
  { id: 'g-home', name: 'Home', categories: [cat('c-mortgage', 'Mortgage', { budgeted: 200000, spent: 200000 })] },
  { id: 'g-fun', name: 'Fun', categories: [cat('c-games', 'Games', { budgeted: 0, spent: 3000 })] },
];

async function run(sectionId, mutate) {
  const settings = defaultSettings();
  settings.exclusions.categoryIds = ['c-mortgage', 'c-dining'];
  mutate(settings);
  const client = {
    getCategoryGroups: jest.fn(async () => BUDGET_GROUPS.map(({ id, name, categories }) => ({ id, name, categories: categories.map(({ id: c, name: n }) => ({ id: c, name: n })) }))),
    getBudgetMonth: jest.fn(async () => ({ categoryGroups: BUDGET_GROUPS })),
  };
  const ctx = await buildContext({ client, now: new Date(2026, 9, 15, 7), period: { kind: 'week', start: '2026-10-08', end: '2026-10-14' }, settings, delivery: { id: 'd1' } });
  return getSection(sectionId).build(ctx);
}

test('both sections are registered with their titles', () => {
  expect(getSection('watched').title).toBe('Watched categories');
  expect(getSection('alerts').title).toBe('Over budget');
  expect(SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['pacing', 'watched', 'alerts']));
});

test('watched shows good and bad categories, including one that is also excluded', async () => {
  const result = await run('watched', (s) => { s.sections.watched.categoryIds = ['c-groc', 'c-dining']; });
  expect(result.data.categories).toEqual([
    { categoryId: 'c-groc', name: 'Groceries', spentCents: 20000, availableCents: 60000, remainingCents: 40000, status: 'under' },
    { categoryId: 'c-dining', name: 'Dining', spentCents: 12500, availableCents: 10000, remainingCents: -2500, status: 'over' },
  ]);
  expect(result.lines).toHaveLength(2);
  expect(result.lines[0]).toMatch(/^Groceries: /);
  expect(result.lines[1]).toMatch(/^Dining: .*over/i);
});

test('watched skips a category id that no longer exists', async () => {
  const result = await run('watched', (s) => { s.sections.watched.categoryIds = ['c-gone', 'c-groc']; });
  expect(result.data.categories.map((c) => c.categoryId)).toEqual(['c-groc']);
});

test('watched with nothing to show returns null', async () => {
  expect(await run('watched', (s) => { s.sections.watched.categoryIds = ['c-gone']; })).toBeNull();
  expect(await run('watched', () => {})).toBeNull();
});

test('alerts shows only over-budget categories, even excluded ones', async () => {
  const result = await run('alerts', (s) => { s.sections.alerts.categoryIds = ['c-groc', 'c-dining', 'c-gone']; });
  expect(result.data.categories).toEqual([
    { categoryId: 'c-dining', name: 'Dining', spentCents: 12500, availableCents: 10000, remainingCents: -2500, status: 'over' },
  ]);
  expect(result.lines).toEqual(['Dining: $125.00 spent of $100.00 (over by $25.00)']);
});

test('alerts ignore spending in a category with nothing available', async () => {
  expect(await run('alerts', (s) => { s.sections.alerts.categoryIds = ['c-games']; })).toBeNull();
});

test('alerts return null when nothing is over', async () => {
  expect(await run('alerts', (s) => { s.sections.alerts.categoryIds = ['c-groc']; })).toBeNull();
});
