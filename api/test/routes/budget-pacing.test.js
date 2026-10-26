jest.mock('../../src/actual-client');

const { getActualClient } = require('../../src/actual-client');

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
  // The route requires TZ to be set (see the TZ-missing test below, which
  // exercises the unset case on its own); give every other test a
  // household-like timezone so day-of-month math is exercised realistically.
  process.env.TZ = 'America/Denver';
});

afterEach(() => {
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
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA,catZ`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([
      { id: 'catA', name: 'Groceries', groupName: 'Everyday Expenses', budgeted: 10000, spent: 4000 },
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
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catB`);
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
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catA`);
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
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catC`);
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ spent: -2000, budgeted: 10000 });
  });
});

test('computes daysInMonth and daysElapsed from the server clock, not Actual data', async () => {
  // "Today" in this test run is 2026-10-26 (before the November test month),
  // so the requested future month should read as not-yet-started.
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=`);
    const body = await res.json();
    expect(body).toMatchObject({ month: '2026-11', daysInMonth: 30, daysElapsed: 0, categories: [] });
  });
});

test('500s (loudly, not silently wrong) when TZ is not set on the server', async () => {
  delete process.env.TZ;
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=`);
    expect(res.status).toBe(500);
  });
});

test('400s when month is missing or malformed', async () => {
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/budget-pacing?categories=catA`);
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/budget-pacing?month=not-a-month&categories=catA`);
    expect(malformed.status).toBe(400);
  });
});
