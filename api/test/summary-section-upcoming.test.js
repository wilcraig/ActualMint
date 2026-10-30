const { buildContext } = require('../src/summary/context');
const { defaultSettings } = require('../src/summary/settings-store');
const { getSection } = require('../src/summary/sections');

const upcoming = getSection('upcoming');

const CATEGORY_GROUPS = [
  { id: 'g-home', name: 'Home', categories: [{ id: 'c-mortgage', name: 'Mortgage' }, { id: 'c-stream', name: 'Streaming' }] },
];

const once = (id, date, amount, extra = {}) => ({ id, completed: false, amount, payee: 'p-gym', account: 'a-chk', date, next_date: date, ...extra });

const SCHEDULES = [
  once('s-gym', '2026-10-30', -5000),
  once('s-card', '2026-11-02', -123456, { name: 'Visa payment', payee: 'p-visa' }),
  once('s-tiny', '2026-10-31', -300, { payee: 'p-app' }),
  once('s-pay', '2026-10-31', 250000, { payee: 'p-employer' }),
  once('s-mortgage', '2026-11-01', -200000, { payee: 'p-bank', rule: 'r-mortgage' }),
  once('s-excluded', '2026-10-30', -8000, { payee: 'p-club' }),
  once('s-landlord', '2026-10-30', -9000, { payee: 'p-landlord' }),
  once('s-far', '2026-11-06', -7000),
  once('s-past', '2026-10-28', -7000),
  once('s-done', '2026-10-30', -7000, { completed: true }),
  {
    id: 's-stream',
    completed: false,
    amount: -1599,
    payee: 'p-stream',
    account: 'a-visa',
    rule: 'r-stream',
    date: { start: '2026-01-05', frequency: 'monthly', interval: 1, patterns: [], skipWeekend: false, weekendSolveMode: 'after', endMode: 'never' },
    next_date: '2026-11-05',
  },
];

function stubClient() {
  return {
    getCategoryGroups: jest.fn(async () => CATEGORY_GROUPS),
    getSchedules: jest.fn(async () => SCHEDULES),
    getRules: jest.fn(async () => [
      { id: 'r-mortgage', actions: [{ op: 'set', field: 'category', value: 'c-mortgage' }] },
      { id: 'r-stream', actions: [{ op: 'set', field: 'category', value: 'c-stream' }] },
    ]),
    getAccounts: jest.fn(async () => [{ id: 'a-chk', name: 'Checking' }, { id: 'a-visa', name: 'Visa' }]),
    aqlQuery: jest.fn(async (query) => {
      const { table } = query.serialize();
      if (table === 'payees') {
        return {
          data: [
            { id: 'p-gym', name: 'Acme Gym' },
            { id: 'p-visa', name: 'Visa' },
            { id: 'p-app', name: 'App Store' },
            { id: 'p-stream', name: 'StreamCo' },
            { id: 'p-club', name: 'Club' },
          ],
        };
      }
      throw new Error(`no stub for ${table}`);
    }),
  };
}

async function run(mutate = () => {}) {
  const settings = defaultSettings();
  settings.exclusions.categoryIds = ['c-mortgage'];
  settings.exclusions.scheduleIds = ['s-excluded'];
  settings.exclusions.payeeIds = ['p-landlord'];
  mutate(settings);
  const ctx = await buildContext({
    client: stubClient(),
    now: new Date(2026, 9, 29, 7),
    period: { kind: 'week', start: '2026-10-22', end: '2026-10-28' },
    settings,
    delivery: { id: 'd1' },
  });
  return upcoming.build(ctx);
}

test('is registered', () => {
  expect(upcoming.title).toBe('Coming up');
});

test('payments from today through the look-ahead window, sorted by date, with a total', async () => {
  const result = await run();
  expect(result.data.items).toEqual([
    { scheduleId: 's-gym', name: 'Acme Gym', date: '2026-10-30', amountCents: 5000, accountName: 'Checking' },
    { scheduleId: 's-tiny', name: 'App Store', date: '2026-10-31', amountCents: 300, accountName: 'Checking' },
    { scheduleId: 's-card', name: 'Visa payment', date: '2026-11-02', amountCents: 123456, accountName: 'Checking' },
    { scheduleId: 's-stream', name: 'StreamCo', date: '2026-11-05', amountCents: 1599, accountName: 'Visa' },
  ]);
  expect(result.data.totalCents).toBe(5000 + 300 + 123456 + 1599);
  expect(result.lines[0]).toBe('2026-10-30 Acme Gym: $50.00 (Checking)');
  expect(result.lines[result.lines.length - 1]).toBe('Total: $1,303.55');
});

test('window bound follows lookAheadDays', async () => {
  const result = await run((s) => { s.sections.upcoming.lookAheadDays = 1; });
  expect(result.data.items.map((i) => i.scheduleId)).toEqual(['s-gym']);
  const wider = await run((s) => { s.sections.upcoming.lookAheadDays = 8; });
  expect(wider.data.items.map((i) => i.scheduleId)).toContain('s-far');
});

test('below the minimum amount is dropped', async () => {
  const result = await run((s) => { s.sections.upcoming.minAmountCents = 1000; });
  expect(result.data.items.map((i) => i.scheduleId)).toEqual(['s-gym', 's-card', 's-stream']);
});

test('excluded schedules, payees and categories are dropped, as are deposits', async () => {
  const ids = (await run()).data.items.map((i) => i.scheduleId);
  for (const id of ['s-excluded', 's-landlord', 's-mortgage', 's-pay', 's-past', 's-done']) expect(ids).not.toContain(id);
});

test('nothing coming up returns null', async () => {
  expect(await run((s) => { s.sections.upcoming.minAmountCents = 99999999; })).toBeNull();
});
