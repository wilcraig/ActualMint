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

function stubClient({ accounts = [], transactionsByAccount = {} } = {}) {
  return {
    getAccounts: jest.fn(async () => accounts),
    getTransactions: jest.fn(async (accountId) => transactionsByAccount[accountId] || []),
  };
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  syncIfDue.mockReset?.();
  if (syncIfDue && syncIfDue.mockResolvedValue) syncIfDue.mockResolvedValue();
  process.env.TZ = 'America/Denver';
  // Pin "today" to 2026-10-26 (see other route test files for the same
  // pattern) so range math doesn't drift as real time passes.
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local (month is 0-indexed)
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

test('builds a daily per-account series carrying forward balance on days with no transactions', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [{ id: 'acc1', name: 'Checking', closed: false }],
      transactionsByAccount: {
        acc1: [
          { id: 't1', date: '2026-10-24', amount: 10000 },
          { id: 't2', date: '2026-10-26', amount: -2000 },
        ],
      },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    const checking = body.accounts.find((a) => a.id === 'acc1');
    const byDate = Object.fromEntries(checking.points.map((p) => [p.date, p.balanceCents]));

    expect(byDate['2026-10-24']).toBe(10000);
    // 2026-10-25 had no transactions: carries forward 2026-10-24's balance.
    expect(byDate['2026-10-25']).toBe(10000);
    expect(byDate['2026-10-26']).toBe(8000);
  });
});

test('the first day of the range shows the correct starting balance from before the range, not zero', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [{ id: 'acc1', name: 'Checking', closed: false }],
      transactionsByAccount: {
        // Well before the 1M range start (2026-09-26) — should still be
        // folded into the starting balance of the first day in range.
        acc1: [{ id: 't1', date: '2020-01-01', amount: 50000 }],
      },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rangeStart).toBe('2026-09-26');
    const checking = body.accounts.find((a) => a.id === 'acc1');
    expect(checking.points[0].date).toBe('2026-09-26');
    expect(checking.points[0].balanceCents).toBe(50000);
  });
});

test('combines all accounts into a netWorth series', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [
        { id: 'acc1', name: 'Checking', closed: false },
        { id: 'acc2', name: 'Savings', closed: false },
      ],
      transactionsByAccount: {
        acc1: [{ id: 't1', date: '2026-10-26', amount: 10000 }],
        acc2: [{ id: 't2', date: '2026-10-26', amount: 25000 }],
      },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    const netWorthToday = body.netWorth.find((p) => p.date === '2026-10-26');
    expect(netWorthToday.balanceCents).toBe(35000);
  });
});

test('excludes a closed account from both its own series and netWorth', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [
        { id: 'acc1', name: 'Checking', closed: false },
        { id: 'acc2', name: 'Old Savings', closed: true },
      ],
      transactionsByAccount: {
        acc1: [{ id: 't1', date: '2026-10-26', amount: 10000 }],
        acc2: [{ id: 't2', date: '2026-10-26', amount: 999999 }],
      },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.accounts.find((a) => a.id === 'acc2')).toBeUndefined();
    const netWorthToday = body.netWorth.find((p) => p.date === '2026-10-26');
    expect(netWorthToday.balanceCents).toBe(10000);
  });
});

test('range=all starts from the earliest transaction date across all accounts', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [
        { id: 'acc1', name: 'Checking', closed: false },
        { id: 'acc2', name: 'Savings', closed: false },
      ],
      transactionsByAccount: {
        acc1: [{ id: 't1', date: '2025-03-15', amount: 10000 }],
        acc2: [{ id: 't2', date: '2024-11-02', amount: 5000 }],
      },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=all`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rangeStart).toBe('2024-11-02');
    expect(body.rangeEnd).toBe('2026-10-26');
  });
});

test('range=all with no transactions anywhere yields a single-point series, not an error', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [{ id: 'acc1', name: 'Checking', closed: false }],
      transactionsByAccount: { acc1: [] },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=all`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rangeStart).toBe('2026-10-26');
    expect(body.rangeEnd).toBe('2026-10-26');
    const checking = body.accounts.find((a) => a.id === 'acc1');
    expect(checking.points).toEqual([{ date: '2026-10-26', balanceCents: 0 }]);
  });
});

test('an account with zero transactions produces a flat zero-balance series, not an error', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [{ id: 'acc1', name: 'Checking', closed: false }],
      transactionsByAccount: { acc1: [] },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    const checking = body.accounts.find((a) => a.id === 'acc1');
    expect(checking.points.length).toBeGreaterThan(1);
    expect(checking.points.every((p) => p.balanceCents === 0)).toBe(true);
  });
});

test('daily series has exactly one entry per calendar day from rangeStart to rangeEnd inclusive', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      accounts: [{ id: 'acc1', name: 'Checking', closed: false }],
      transactionsByAccount: { acc1: [] },
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=1M`, { headers: AUTH_HEADERS });
    const body = await res.json();

    expect(body.rangeStart).toBe('2026-09-26');
    expect(body.rangeEnd).toBe('2026-10-26');

    const checking = body.accounts.find((a) => a.id === 'acc1');
    // 2026-09-26 through 2026-10-26 inclusive = 31 days.
    expect(checking.points.length).toBe(31);
    expect(checking.points[0].date).toBe('2026-09-26');
    expect(checking.points[checking.points.length - 1].date).toBe('2026-10-26');

    const dates = checking.points.map((p) => p.date);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

test('an invalid range value 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({ accounts: [] }));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/account-balances?range=bogus`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
  });
});
