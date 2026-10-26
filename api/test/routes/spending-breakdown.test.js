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

// `getActualClient()` resolves the real `api` module object from
// @actual-app/api in production, which exposes `aqlQuery` (and `q`, used
// directly by the route via a top-level require of the real package rather
// than through the client — see spending-breakdown.js). The stub below only
// needs to fake `aqlQuery`, keyed by table name so a single mock can answer
// both the aggregation query and the name-lookup query a request makes.
function stubClient(responsesByTable) {
  return {
    aqlQuery: jest.fn(async (query) => {
      const table = query.serialize().table;
      const response = responsesByTable[table];
      if (!response) {
        throw new Error(`stubClient: no stubbed response for table "${table}"`);
      }
      return { data: typeof response === 'function' ? response(query) : response };
    }),
  };
}

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('level=groups aggregates spending by category group, excluding income groups', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      transactions: [
        { groupId: 'group1', amountCents: -4000 },
        { groupId: 'group2', amountCents: -1500 },
      ],
      category_groups: [
        { id: 'group1', name: 'Everyday Expenses', is_income: false },
        { id: 'group2', name: 'Housing', is_income: false },
        { id: 'group3', name: 'Paychecks', is_income: true },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=groups`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total: 5500,
      slices: [
        { id: 'group1', label: 'Everyday Expenses', amountCents: 4000 },
        { id: 'group2', label: 'Housing', amountCents: 1500 },
      ],
    });
  });
});

test('level=categories requires groupId (400 without it)', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=categories`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'groupId is required for level=categories' });
  });
});

test('level=categories aggregates spending by category within the given group', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      transactions: [
        { categoryId: 'catA', amountCents: -2500 },
        { categoryId: 'catB', amountCents: -750 },
      ],
      categories: [
        { id: 'catA', name: 'Groceries', group: 'group1' },
        { id: 'catB', name: 'Dining', group: 'group1' },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=categories&groupId=group1`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total: 3250,
      slices: [
        { id: 'catA', label: 'Groceries', amountCents: 2500 },
        { id: 'catB', label: 'Dining', amountCents: 750 },
      ],
    });
  });
});

test('level=payees requires categoryId (400 without it)', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=payees`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'categoryId is required for level=payees' });
  });
});

test('level=payees aggregates spending by payee within the given category', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      transactions: [
        { payeeId: 'payeeA', amountCents: -3000 },
        { payeeId: null, amountCents: -100 },
      ],
      payees: [{ id: 'payeeA', name: 'Trader Joes' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=payees&categoryId=catA`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total: 3100,
      slices: [
        { id: 'payeeA', label: 'Trader Joes', amountCents: 3000 },
        { id: null, label: '(No payee)', amountCents: 100 },
      ],
    });
  });
});

test('a payee/category/group with net inflow (negative negated amount) is omitted from slices', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      transactions: [
        { payeeId: 'payeeA', amountCents: -3000 },
        // Net inflow for the month (more refunds than spending): raw amount
        // is positive, so after negation this becomes <= 0 and must be
        // dropped, not included at a negative or zero amountCents.
        { payeeId: 'payeeRefund', amountCents: 2000 },
      ],
      payees: [
        { id: 'payeeA', name: 'Trader Joes' },
        { id: 'payeeRefund', name: 'Returns Desk' },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=payees&categoryId=catA`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total: 3000,
      slices: [{ id: 'payeeA', label: 'Trader Joes', amountCents: 3000 }],
    });
  });
});

test('an invalid level value 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=bogus`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(400);
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/spending-breakdown?level=groups`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/spending-breakdown?month=not-a-month&level=groups`, {
      headers: AUTH_HEADERS,
    });
    expect(malformed.status).toBe(400);
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=groups`);
    expect(res.status).toBe(401);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
