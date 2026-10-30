const { buildContext } = require('../src/summary/context');
const { defaultSettings } = require('../src/summary/settings-store');
const { resolvePeriod } = require('../src/summary/period');
const { getSection } = require('../src/summary/sections');

const largest = getSection('largest');

const CATEGORY_GROUPS = [
  { id: 'g-food', name: 'Food', categories: [{ id: 'c-groc', name: 'Groceries' }, { id: 'c-dining', name: 'Dining' }] },
  { id: 'g-home', name: 'Home', categories: [{ id: 'c-mortgage', name: 'Mortgage' }, { id: 'c-stream', name: 'Streaming' }] },
  { id: 'g-inc', name: 'Income', is_income: true, categories: [{ id: 'c-start', name: 'Starting Balances' }] },
  { id: 'g-xfer', name: 'Transfers', categories: [{ id: 'c-xfer', name: 'To savings' }] },
];

const tx = (id, date, amount, extra = {}) => ({
  id,
  date,
  amount,
  payee: 'p-shop',
  category: 'c-groc',
  account: 'a-visa',
  schedule: null,
  transfer_id: null,
  starting_balance_flag: false,
  ...extra,
});

const BASE_ROWS = [
  tx('t-big', '2026-10-27', -45000),
  tx('t-mid', '2026-10-24', -12000, { category: 'c-dining', payee: 'p-cafe' }),
  tx('t-small', '2026-10-23', -2500),
  tx('t-refund', '2026-10-25', 3000),
  tx('t-mortgage', '2026-10-26', -200000, { category: 'c-mortgage', payee: 'p-bank' }),
  tx('t-landlord', '2026-10-26', -90000, { payee: 'p-landlord' }),
  tx('t-xfer-linked', '2026-10-26', -80000, { transfer_id: 't-other', category: null }),
  tx('t-xfer-group', '2026-10-26', -70000, { category: 'c-xfer' }),
  tx('t-start', '2026-10-22', -60000, { category: 'c-start', starting_balance_flag: true }),
  tx('t-scheduled', '2026-10-25', -30000, { category: 'c-stream', schedule: 's-stream', payee: 'p-stream' }),
  tx('t-old', '2026-09-10', -99000),
];

function stubClient(rows) {
  const queries = [];
  return {
    queries,
    getCategoryGroups: jest.fn(async () => CATEGORY_GROUPS),
    getAccounts: jest.fn(async () => [{ id: 'a-visa', name: 'Visa' }]),
    aqlQuery: jest.fn(async (query) => {
      const s = query.serialize();
      queries.push(s);
      if (s.table === 'payees') {
        return { data: [{ id: 'p-shop', name: 'Grocer' }, { id: 'p-cafe', name: 'Cafe' }, { id: 'p-stream', name: 'StreamCo' }] };
      }
      if (s.table === 'transactions') {
        const [{ date: { $gte: start } }, { date: { $lte: end } }] = s.filterExpressions[0].$and;
        return { data: rows.filter((r) => r.date >= start && r.date <= end) };
      }
      throw new Error(`no stub for ${s.table}`);
    }),
  };
}

async function run({ kind = 'week', now = new Date(2026, 9, 29, 7), rows = BASE_ROWS, mutate = () => {}, reportedIds = new Set(), lastSentAt = null } = {}) {
  const settings = defaultSettings();
  settings.exclusions.categoryIds = ['c-mortgage'];
  settings.exclusions.payeeIds = ['p-landlord'];
  mutate(settings);
  const client = stubClient(rows);
  const ctx = await buildContext({
    client,
    now,
    period: resolvePeriod(kind, now, lastSentAt),
    settings,
    delivery: { id: 'd1' },
    reportedIds,
    lastSentAt,
  });
  return { result: await largest.build(ctx), client };
}

test('is registered', () => {
  expect(largest.title).toBe('Largest transactions');
});

test('top spending ordered by amount, with names resolved and positive cents', async () => {
  const { result } = await run();
  expect(result.data.items.map((i) => i.id)).toEqual(['t-big', 't-mid', 't-small']);
  expect(result.data.items[0]).toEqual({
    id: 't-big',
    date: '2026-10-27',
    payee: 'Grocer',
    categoryName: 'Groceries',
    accountName: 'Visa',
    amountCents: 45000,
    inHighlight: false,
  });
  expect(result.lines[0]).toContain('$450.00');
  expect(result.lines[0]).toContain('Grocer');
});

test('queries the period with a two-clause date range, never a two-operator filter', async () => {
  const { client } = await run();
  const txQuery = client.queries.find((s) => s.table === 'transactions');
  expect(txQuery.filterExpressions[0].$and).toEqual([{ date: { $gte: '2026-10-22' } }, { date: { $lte: '2026-10-28' } }]);
  expect(txQuery.filterExpressions[0]).toMatchObject({ tombstone: false, transfer_id: null, starting_balance_flag: false });
});

test('excluded categories and payees, transfers, starting balances, income and refunds are absent', async () => {
  const { result } = await run();
  const ids = result.data.items.map((i) => i.id);
  for (const id of ['t-refund', 't-mortgage', 't-landlord', 't-xfer-linked', 't-xfer-group', 't-start']) expect(ids).not.toContain(id);
});

test('scheduled payments are excluded by default and included when the toggle is off', async () => {
  expect((await run()).result.data.items.map((i) => i.id)).not.toContain('t-scheduled');
  const { result } = await run({ mutate: (s) => { s.sections.largest.excludeScheduled = false; } });
  expect(result.data.items.map((i) => i.id)).toEqual(['t-big', 't-scheduled', 't-mid', 't-small']);
});

test('count and minimum amount', async () => {
  const { result } = await run({ mutate: (s) => { s.sections.largest.count = 1; } });
  expect(result.data.items.map((i) => i.id)).toEqual(['t-big']);
  const min = await run({ mutate: (s) => { s.sections.largest.minAmountCents = 10000; } });
  expect(min.result.data.items.map((i) => i.id)).toEqual(['t-big', 't-mid']);
});

test('nothing to report returns null', async () => {
  const { result } = await run({ rows: [tx('t-refund', '2026-10-25', 3000)] });
  expect(result).toBeNull();
});

test('reportedIds lists the ids shown', async () => {
  const { result } = await run({ mutate: (s) => { s.sections.largest.count = 2; } });
  expect(result.reportedIds).toEqual(['t-big', 't-mid']);
});

test('month-to-date flags items in the last 7 days', async () => {
  const rows = [tx('t-early', '2026-10-03', -50000), tx('t-late', '2026-10-24', -40000), tx('t-edge', '2026-10-22', -1000), tx('t-before', '2026-10-21', -500)];
  const { result } = await run({ kind: 'month-to-date', rows });
  const flags = Object.fromEntries(result.data.items.map((i) => [i.id, i.inHighlight]));
  expect(flags).toEqual({ 't-early': false, 't-late': true, 't-edge': true, 't-before': false });
});

describe('since-last', () => {
  const lastSentAt = new Date(2026, 9, 26, 7); // three days ago

  test('drops ids already reported', async () => {
    const { result } = await run({ kind: 'since-last', lastSentAt, reportedIds: new Set(['t-big']) });
    expect(result.data.items.map((i) => i.id)).not.toContain('t-big');
  });

  test('includes a late-imported transaction dated before the last send', async () => {
    // Dated the 20th, before the last send on the 26th, but never reported.
    const rows = [...BASE_ROWS, tx('t-late-import', '2026-10-20', -15000)];
    const { result, client } = await run({ kind: 'since-last', lastSentAt, rows, reportedIds: new Set(['t-big', 't-mid', 't-small']) });
    expect(result.data.items.map((i) => i.id)).toEqual(['t-late-import']);
    const txQuery = client.queries.find((s) => s.table === 'transactions');
    expect(txQuery.filterExpressions[0].$and[0]).toEqual({ date: { $gte: '2026-10-15' } });
  });

  test('a transaction reported once is not reported again on the next send', async () => {
    const rows = [...BASE_ROWS, tx('t-late-import', '2026-10-20', -15000)];
    const first = await run({ kind: 'since-last', lastSentAt, rows, reportedIds: new Set(['t-big', 't-mid', 't-small']) });
    const reported = new Set(['t-big', 't-mid', 't-small', ...first.result.reportedIds]);
    const second = await run({ kind: 'since-last', now: new Date(2026, 9, 30, 7), lastSentAt: new Date(2026, 9, 29, 7), rows, reportedIds: reported });
    expect(second.result).toBeNull();
  });

  test('marks every new candidate seen, not only the top few, so a near-miss is not "new" next time', async () => {
    const { result } = await run({ kind: 'since-last', lastSentAt, mutate: (s) => { s.sections.largest.count = 1; } });
    expect(result.data.items.map((i) => i.id)).toEqual(['t-big']);
    expect(result.reportedIds.sort()).toEqual(['t-big', 't-mid', 't-small']);
  });

  test('the first send covers only the last 7 days', async () => {
    const { client } = await run({ kind: 'since-last' });
    const txQuery = client.queries.find((s) => s.table === 'transactions');
    expect(txQuery.filterExpressions[0].$and[0]).toEqual({ date: { $gte: '2026-10-22' } });
  });
});
