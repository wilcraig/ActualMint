jest.mock('../../src/actual-client');
jest.mock('../../src/auth');

const { getActualClient } = require('../../src/actual-client');
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

function stubClient(categoryGroups) {
  return {
    getBudgetMonth: jest.fn(async (month) => ({ month, categoryGroups })),
  };
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  // All of the behavioral tests below assume a valid session token; the
  // auth-specific tests further down override this per case.
  validateToken.mockResolvedValue(true);
  // The route requires TZ to be set (see the TZ-missing test below, which
  // exercises the unset case on its own); give every other test a
  // household-like timezone so day-of-month math is exercised realistically.
  process.env.TZ = 'America/Denver';
  // Pin "today" instead of relying on the real wall clock (final-review Fix
  // 4) — the test below asserting daysElapsed=0 for a "future" 2026-11
  // request depends on "today" actually being before that month.
  // `doNotFake` keeps the real HTTP fetch/server-listening machinery
  // `withServer` relies on working.
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

test('omits a requested category id not present in the budget', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        // Actual stores outflows as negative; -4000 is $40 of real spending.
        categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: -4000 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA,catZ`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([
      { id: 'catA', name: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses', budgeted: 10000, spent: 4000 },
    ]);
  });
});

test('a category budgeted at 0 is included with budgeted: 0, not dropped or NaN', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        categories: [{ id: 'catB', name: 'Dining', budgeted: 0, spent: -500 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catB`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ id: 'catB', budgeted: 0, spent: 500 });
  });
});

test('negates Actual\'s negative-outflow spent into a positive spending amount', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: -4000 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ spent: 4000, budgeted: 10000 });
  });
});

test('a refund-heavy category (net inflow) comes back with a negative spent after negation', async () => {
  // Actual reports a net-positive `spent` for a category with more refunds
  // than spending that month (net inflow); after our negation this becomes
  // negative. The route passes it through as-is — clamping to a sane fill
  // percentage is pacing-data.js's job, covered in bundle/test/pacing-data.test.js.
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        categories: [{ id: 'catC', name: 'Travel', budgeted: 10000, spent: 2000 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catC`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ spent: -2000, budgeted: 10000 });
  });
});

test('computes daysInMonth and daysElapsed from the server clock, not Actual data', async () => {
  // "Today" in this test run is 2026-10-26 (before the November test month),
  // so the requested future month should read as not-yet-started.
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body).toMatchObject({ month: '2026-11', daysInMonth: 30, daysElapsed: 0, categories: [] });
  });
});

test('500s (loudly, not silently wrong) when TZ is not set on the server', async () => {
  delete process.env.TZ;
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(500);
  });
});

test('400s when month is missing or malformed', async () => {
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/budget-pacing?categories=catA`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/budget-pacing?month=not-a-month&categories=catA`, { headers: AUTH_HEADERS });
    expect(malformed.status).toBe(400);
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(validateToken).not.toHaveBeenCalled();
  });
});

test('401s with an invalid token', async () => {
  validateToken.mockResolvedValue(false);
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`, {
      headers: { 'X-ACTUAL-TOKEN': 'bogus-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });
});

test('proceeds normally with a valid token', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: -4000 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([
      { id: 'catA', name: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses', budgeted: 10000, spent: 4000 },
    ]);
    expect(validateToken).toHaveBeenCalledWith('valid-test-token');
  });
});

test('includes the category\'s group id alongside groupName', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      { id: 'group1', name: 'Everyday Expenses', categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: -4000 }] },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ id: 'catA', groupId: 'group1', groupName: 'Everyday Expenses' });
  });
});
