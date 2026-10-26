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

// `q` is the real (unmocked) `@actual-app/api` builder, so a `Query` object
// passed to the mocked `aqlQuery` has gone through the real filter/groupBy/
// select chain. Returns the serialized state of the call made against
// `table`, so a test can assert the exact field paths the route built —
// e.g. `'category.group.is_income'` not a typo'd `'category.grop...'` —
// which a table-name-keyed canned response alone would never catch (a typo
// just produces an empty/wrong result set against a real database; against
// this stub it'd still "work" since the stub never inspects the filter).
function serializedQueryFor(client, table) {
  const call = client.aqlQuery.mock.calls.find(([query]) => query.serialize().table === table);
  if (!call) {
    throw new Error(`serializedQueryFor: aqlQuery was never called for table "${table}"`);
  }
  return call[0].serialize();
}

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('level=groups aggregates spending by category group, excluding income groups', async () => {
  const client = stubClient({
    transactions: [
      { groupId: 'group1', amountCents: -4000 },
      { groupId: 'group2', amountCents: -1500 },
    ],
    category_groups: [
      { id: 'group1', name: 'Everyday Expenses', is_income: false },
      { id: 'group2', name: 'Housing', is_income: false },
      { id: 'group3', name: 'Paychecks', is_income: true },
    ],
  });
  getActualClient.mockResolvedValue(client);

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

    // Assert on the REAL Query object's serialized shape (q() is the real,
    // unmocked builder) so a typo'd field path — e.g.
    // 'category.grop.is_income' or grouping by the wrong field — fails this
    // test even though the stub above never looks at the filter contents.
    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      { date: { $gte: '2026-11-01', $lte: '2026-11-30' }, tombstone: false, 'category.group.is_income': false },
    ]);
    expect(serialized.groupExpressions).toEqual(['category.group']);
    expect(serialized.selectExpressions).toEqual([{ groupId: 'category.group' }, { amountCents: { $sum: '$amount' } }]);
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

test('level=categories 400s when groupId is not a plain string (Express query-parser object)', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    // Express's default (extended) query parser turns `groupId[$ne]=x` into
    // `req.query.groupId = { $ne: 'x' }` rather than a string -- which,
    // left unchecked, would reach the AQL query builder as an operator
    // object instead of a literal filter value.
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=categories&groupId[$ne]=x`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'groupId is required for level=categories' });
  });
});

test('level=payees 400s when categoryId is not a plain string (Express query-parser object)', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-breakdown?month=2026-11&level=payees&categoryId[$ne]=x`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'categoryId is required for level=payees' });
  });
});

test('level=categories aggregates spending by category within the given group', async () => {
  const client = stubClient({
    transactions: [
      { categoryId: 'catA', amountCents: -2500 },
      { categoryId: 'catB', amountCents: -750 },
    ],
    categories: [
      { id: 'catA', name: 'Groceries', group: 'group1' },
      { id: 'catB', name: 'Dining', group: 'group1' },
    ],
  });
  getActualClient.mockResolvedValue(client);

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

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      { date: { $gte: '2026-11-01', $lte: '2026-11-30' }, tombstone: false, 'category.group': 'group1' },
    ]);
    expect(serialized.groupExpressions).toEqual(['category']);
    expect(serialized.selectExpressions).toEqual([{ categoryId: 'category' }, { amountCents: { $sum: '$amount' } }]);
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
  const client = stubClient({
    transactions: [
      { payeeId: 'payeeA', amountCents: -3000 },
      { payeeId: null, amountCents: -100 },
    ],
    payees: [{ id: 'payeeA', name: 'Trader Joes' }],
  });
  getActualClient.mockResolvedValue(client);

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

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      { date: { $gte: '2026-11-01', $lte: '2026-11-30' }, tombstone: false, category: 'catA' },
    ]);
    expect(serialized.groupExpressions).toEqual(['payee']);
    expect(serialized.selectExpressions).toEqual([{ payeeId: 'payee' }, { amountCents: { $sum: '$amount' } }]);
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
