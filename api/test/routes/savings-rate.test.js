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

// Same budget shape as the real one: Actual's built-in Income group holds
// only Starting Balances, paychecks live in an unflagged "Personal Income"
// group, and a user-made "Transfers" group holds moves between accounts.
const CATEGORY_GROUPS = [
  { id: 'g-income', name: 'Income', is_income: true, categories: [{ id: 'c-start', name: 'Starting Balances' }] },
  { id: 'g-personal', name: 'Personal Income', is_income: false, categories: [{ id: 'c-pay', name: 'Paycheck' }] },
  { id: 'g-food', name: 'Food', is_income: false, categories: [{ id: 'c-groceries', name: 'Groceries' }] },
  { id: 'g-invest', name: 'Investing', is_income: false, categories: [{ id: 'c-529', name: '529' }] },
  { id: 'g-xfer', name: 'Transfers', is_income: false, categories: [{ id: 'c-savings', name: 'Share Savings' }] },
];

// Rows as the starting_balance_flag: false query returns them (starting
// balances are filtered out in the query itself).
const ROWS = [
  { categoryId: 'c-pay', amountCents: 500000 },
  { categoryId: 'c-groceries', amountCents: -300000 },
  { categoryId: 'c-529', amountCents: -50000 },
  { categoryId: 'c-savings', amountCents: -900000 },
];

function stubClient(rows = ROWS) {
  return {
    aqlQuery: jest.fn(async () => ({ data: rows })),
    getCategoryGroups: jest.fn(async () => CATEGORY_GROUPS),
  };
}

async function getRate(base, query) {
  const res = await fetch(`${base}/api/savings-rate?${query}`, { headers: AUTH_HEADERS });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('income counts the unflagged "Personal Income" group; Transfers is not spending; starting balances are excluded', async () => {
  const client = stubClient();
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const { status, body } = await getRate(base, 'month=2026-10');
    expect(status).toBe(200);
    expect(body).toEqual({
      incomeCents: 500000,
      outflowCents: 350000,
      investmentCents: 0,
      rate: (500000 - 350000) / 500000,
    });
  });

  expect(client.aqlQuery.mock.calls[0][0].serialize().filterExpressions[0]).toEqual({
    $and: [{ date: { $gte: '2026-10-01' } }, { date: { $lte: '2026-10-31' } }],
    tombstone: false,
    transfer_id: null,
    starting_balance_flag: false,
  });
});

test('investmentGroupIds adds that group\'s spending back in as saving', async () => {
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    const { body } = await getRate(base, 'month=2026-10&investmentGroupIds=g-invest');
    expect(body.investmentCents).toBe(50000);
    expect(body.rate).toBeCloseTo((500000 - 350000 + 50000) / 500000);
  });
});

test('an investmentGroupIds entry that does not resolve to a real group contributes nothing, not a 400', async () => {
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    const { status, body } = await getRate(base, 'month=2026-10&investmentGroupIds=nope,g-invest');
    expect(status).toBe(200);
    expect(body.investmentCents).toBe(50000);
  });
});

test('agrees with /api/cash-flow\'s income and spending totals', async () => {
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    const { body: rate } = await getRate(base, 'month=2026-10');
    const flow = await (await fetch(`${base}/api/cash-flow?month=2026-10`, { headers: AUTH_HEADERS })).json();
    expect(rate.incomeCents).toBe(flow.incomeCents);
    expect(rate.outflowCents).toBe(flow.spendingCents);
  });
});

test('no income returns rate: null, not NaN or Infinity', async () => {
  getActualClient.mockResolvedValue(stubClient([{ categoryId: 'c-groceries', amountCents: -1000 }]));

  await withServer(async (base) => {
    const { body } = await getRate(base, 'month=2026-10');
    expect(body.incomeCents).toBe(0);
    expect(body.rate).toBeNull();
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    expect((await getRate(base, '')).status).toBe(400);
    expect((await getRate(base, 'month=2026-1')).status).toBe(400);
  });
});

test('401s with no token', async () => {
  validateToken.mockResolvedValue(false);
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    expect((await getRate(base, 'month=2026-10')).status).toBe(401);
  });
});
