jest.mock('../../src/actual-client');
jest.mock('../../src/auth');

const { getActualClient, syncIfDue } = require('../../src/actual-client');
const { validateToken } = require('../../src/auth');

const AUTH_HEADERS = { 'X-ACTUAL-TOKEN': 'valid-test-token' };

async function withServer(fn) {
  const app = require('../../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Same stubClient/serializedQueryFor technique as spending-breakdown.test.js
// -- `q` is the real (unmocked) @actual-app/api builder, so a Query object
// passed to the mocked aqlQuery has gone through the real filter/groupBy/
// select chain and can be asserted on exactly.
function stubClient({ categoryGroups = [], transactionsByTable = {} } = {}) {
  return {
    getBudgetMonth: jest.fn(async (month) => ({ month, categoryGroups })),
    aqlQuery: jest.fn(async (query) => {
      const table = query.serialize().table;
      const response = transactionsByTable[table];
      if (!response) {
        throw new Error(`stubClient: no stubbed response for table "${table}"`);
      }
      return { data: typeof response === 'function' ? response(query) : response };
    }),
  };
}

function serializedQueryFor(client, table) {
  const call = client.aqlQuery.mock.calls.find(([query]) => query.serialize().table === table);
  if (!call) {
    throw new Error(`serializedQueryFor: aqlQuery was never called for table "${table}"`);
  }
  return call[0].serialize();
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  syncIfDue.mockReset?.();
  if (syncIfDue && syncIfDue.mockResolvedValue) syncIfDue.mockResolvedValue();
  process.env.TZ = 'America/Denver';
  // Pin "today" to 2026-10-26 (same pattern as account-balances.test.js and
  // month-end-projection.test.js) so range math doesn't drift as real time
  // passes.
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local (month is 0-indexed)
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

test('budgetedCents sums budgeted across expense categories, excluding hidden ones', async () => {
  const client = stubClient({
    categoryGroups: [
      {
        id: 'group1',
        is_income: false,
        categories: [
          { id: 'catA', budgeted: 50000, hidden: false },
          { id: 'catB', budgeted: 20000, hidden: true },
        ],
      },
      {
        id: 'group2',
        is_income: true,
        categories: [{ id: 'catC', budgeted: 999999, hidden: false }],
      },
    ],
    transactionsByTable: { transactions: [] },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.budgetedCents).toBe(50000);
  });
});

test('budgetedCents excludes categories under a hidden group, even when the category itself is not hidden', async () => {
  const client = stubClient({
    categoryGroups: [
      {
        id: 'group1',
        is_income: false,
        hidden: false,
        categories: [{ id: 'catA', budgeted: 50000, hidden: false }],
      },
      // Mirrors categories.test.js's own "Archived Group" fixture: the group
      // is hidden, but its one category is not -- the whole group's budgeted
      // total must still be excluded.
      {
        id: 'group2',
        is_income: false,
        hidden: true,
        categories: [{ id: 'catB', budgeted: 30000, hidden: false }],
      },
    ],
    transactionsByTable: { transactions: [] },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.budgetedCents).toBe(50000);
  });
});

test('days is a running cumulative total of non-transfer, non-income spending from day 1 through today (current month)', async () => {
  const client = stubClient({
    categoryGroups: [],
    transactionsByTable: {
      transactions: [
        { date: '2026-10-01', amountCents: -1000 },
        { date: '2026-10-03', amountCents: -500 },
      ],
    },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    // "today" is pinned to 2026-10-26, so days runs day 1 through day 26.
    expect(body.days.length).toBe(26);
    expect(body.days[0]).toEqual({ date: '2026-10-01', cumulativeSpendCents: 1000 });
    expect(body.days[1]).toEqual({ date: '2026-10-02', cumulativeSpendCents: 1000 });
    expect(body.days[2]).toEqual({ date: '2026-10-03', cumulativeSpendCents: 1500 });
    expect(body.days[25]).toEqual({ date: '2026-10-26', cumulativeSpendCents: 1500 });

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      {
        date: { $gte: '2026-10-01', $lte: '2026-10-26' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
      },
    ]);
  });
});

test('a past month: days runs through the whole month, not just "today"', async () => {
  const client = stubClient({
    categoryGroups: [],
    transactionsByTable: {
      transactions: [{ date: '2026-09-15', amountCents: -3000 }],
    },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-09`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    // September 2026 has 30 days.
    expect(body.days.length).toBe(30);
    expect(body.days[0]).toEqual({ date: '2026-09-01', cumulativeSpendCents: 0 });
    expect(body.days[14]).toEqual({ date: '2026-09-15', cumulativeSpendCents: 3000 });
    // The running total carries forward through the end of the month.
    expect(body.days[29]).toEqual({ date: '2026-09-30', cumulativeSpendCents: 3000 });

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      {
        date: { $gte: '2026-09-01', $lte: '2026-09-30' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
      },
    ]);
  });
});

test('the current month on the 1st: days has exactly one entry', async () => {
  jest.setSystemTime(new Date(2026, 9, 1, 10)); // 2026-10-01, 10:00 local

  const client = stubClient({
    categoryGroups: [],
    transactionsByTable: {
      transactions: [{ date: '2026-10-01', amountCents: -1200 }],
    },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.days.length).toBe(1);
    expect(body.days[0]).toEqual({ date: '2026-10-01', cumulativeSpendCents: 1200 });

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      {
        date: { $gte: '2026-10-01', $lte: '2026-10-01' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
      },
    ]);
  });
});

test('a future month: days is a full-length array of all-zero entries, not empty', async () => {
  const client = stubClient({ categoryGroups: [] });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-12`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    // December 2026 has 31 days -- all zero-filled, no transactions query.
    expect(body.days.length).toBe(31);
    expect(body.days[0]).toEqual({ date: '2026-12-01', cumulativeSpendCents: 0 });
    expect(body.days[30]).toEqual({ date: '2026-12-31', cumulativeSpendCents: 0 });
    expect(client.aqlQuery).not.toHaveBeenCalled();
  });
});

test("the AQL filter excludes transfer_id and income groups (assert on the real Query object's serialized filter, same as spending-breakdown.test.js)", async () => {
  const client = stubClient({
    categoryGroups: [],
    transactionsByTable: { transactions: [] },
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    await fetch(`${base}/api/burn-rate?month=2026-10`, { headers: AUTH_HEADERS });

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      {
        date: { $gte: '2026-10-01', $lte: '2026-10-26' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
      },
    ]);
    expect(serialized.groupExpressions).toEqual(['date']);
    expect(serialized.selectExpressions).toEqual([{ date: 'date' }, { amountCents: { $sum: '$amount' } }]);
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/burn-rate`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/burn-rate?month=not-a-month`, { headers: AUTH_HEADERS });
    expect(malformed.status).toBe(400);
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/burn-rate?month=2026-10`);
    expect(res.status).toBe(401);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
