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

beforeEach(() => {
  getActualClient.mockReset();
});

test('omits a requested category id not present in the budget', async () => {
  getActualClient.mockResolvedValue(
    stubClient([
      {
        id: 'group1',
        name: 'Everyday Expenses',
        categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: 4000 }],
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
        categories: [{ id: 'catB', name: 'Dining', budgeted: 0, spent: 500 }],
      },
    ])
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budget-pacing?month=2026-11&categories=catB`);
    const body = await res.json();
    expect(body.categories[0]).toMatchObject({ id: 'catB', budgeted: 0, spent: 500 });
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

test('400s when month is missing or malformed', async () => {
  getActualClient.mockResolvedValue(stubClient([]));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/budget-pacing?categories=catA`);
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/budget-pacing?month=not-a-month&categories=catA`);
    expect(malformed.status).toBe(400);
  });
});
