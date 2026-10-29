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

const CATEGORY_GROUPS = [
  {
    id: 'g-income',
    name: 'Income',
    is_income: true,
    categories: [
      { id: 'c-pay', name: 'Paychecks' },
      { id: 'c-interest', name: 'Interest' },
      { id: 'c-clawback', name: 'Clawback' },
    ],
  },
  {
    id: 'g-food',
    name: 'Food',
    is_income: false,
    categories: [
      { id: 'c-groceries', name: 'Groceries' },
      { id: 'c-dining', name: 'Dining' },
      { id: 'c-refund', name: 'Refunded' },
    ],
  },
  { id: 'g-home', name: 'Home', is_income: false, categories: [{ id: 'c-rent', name: 'Rent' }] },
  { id: 'g-personal', name: 'Personal Income', is_income: false, categories: [{ id: 'c-side', name: 'Side gig' }] },
  { id: 'g-transfers', name: 'Transfers', is_income: false, categories: [{ id: 'c-xfer', name: 'Share Savings' }] },
];

function stubClient(rows) {
  return {
    aqlQuery: jest.fn(async () => ({ data: rows })),
    getCategoryGroups: jest.fn(async () => CATEGORY_GROUPS),
  };
}

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('splits the month into income categories and expense groups with nested categories', async () => {
  const client = stubClient([
    { categoryId: 'c-pay', amountCents: 500000 },
    { categoryId: 'c-interest', amountCents: 1200 },
    { categoryId: 'c-clawback', amountCents: -300 },
    { categoryId: 'c-groceries', amountCents: -40000 },
    { categoryId: 'c-dining', amountCents: -15000 },
    { categoryId: 'c-refund', amountCents: 2500 },
    { categoryId: 'c-rent', amountCents: -200000 },
    { categoryId: 'c-side', amountCents: 3000 },
    { categoryId: 'c-xfer', amountCents: -70000 },
    { categoryId: null, amountCents: -999 },
    { categoryId: 'c-deleted', amountCents: -888 },
  ]);
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cash-flow?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      incomeCents: 504200,
      spendingCents: 255000,
      income: [
        { id: 'c-pay', label: 'Paychecks', amountCents: 500000 },
        { id: 'c-side', label: 'Side gig', amountCents: 3000 },
        { id: 'c-interest', label: 'Interest', amountCents: 1200 },
      ],
      groups: [
        { id: 'g-home', label: 'Home', amountCents: 200000, categories: [{ id: 'c-rent', label: 'Rent', amountCents: 200000 }] },
        {
          id: 'g-food',
          label: 'Food',
          amountCents: 55000,
          categories: [
            { id: 'c-groceries', label: 'Groceries', amountCents: 40000 },
            { id: 'c-dining', label: 'Dining', amountCents: 15000 },
          ],
        },
      ],
    });
  });

  const { filterExpressions, groupExpressions } = client.aqlQuery.mock.calls[0][0].serialize();
  expect(filterExpressions[0]).toEqual({
    $and: [{ date: { $gte: '2026-10-01' } }, { date: { $lte: '2026-10-31' } }],
    tombstone: false,
    transfer_id: null,
    starting_balance_flag: false,
  });
  expect(groupExpressions).toEqual(['category']);
});

test('rejects a malformed month', async () => {
  getActualClient.mockResolvedValue(stubClient([]));
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cash-flow?month=2026-1`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
  });
});

test('requires auth', async () => {
  validateToken.mockResolvedValue(false);
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/cash-flow?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(401);
  });
});
