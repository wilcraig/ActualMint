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
// than through the client -- see spending-breakdown.js). The stub below
// keys responses by table name, with a function-form response allowed so a
// single table's multiple distinct queries (here, all three of
// savings-rate.js's sums hit the same 'transactions' table) can be told
// apart by inspecting the serialized filter -- same pattern
// spending-breakdown.test.js's own stubClient documents.
function stubClient(responder) {
  return {
    aqlQuery: jest.fn(async (query) => ({ data: responder(query) })),
  };
}

function serializedCallsFor(client) {
  return client.aqlQuery.mock.calls.map(([query]) => query.serialize());
}

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('computes rate = (income - outflow + investment) / income', async () => {
  const client = stubClient((query) => {
    const { filterExpressions } = query.serialize();
    const filter = filterExpressions[0];
    if (filter['category.group.is_income'] === true) {
      // incomeCents: 500000
      return [{ amountCents: 500000 }];
    }
    if (filter['category.group']) {
      // investmentCents: 50000 of outflow is investment (stored negative)
      return [{ amountCents: -50000 }];
    }
    // outflowCents: 300000 of outflow total (stored negative)
    return [{ amountCents: -300000 }];
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(
      `${base}/api/savings-rate?month=2026-11&investmentGroupIds=group1`,
      { headers: AUTH_HEADERS }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      incomeCents: 500000,
      outflowCents: 300000,
      investmentCents: 50000,
      rate: (500000 - 300000 + 50000) / 500000,
    });

    const calls = serializedCallsFor(client);
    const incomeCall = calls.find((c) => c.filterExpressions[0]['category.group.is_income'] === true);
    expect(incomeCall.filterExpressions).toEqual([
      { date: { $gte: '2026-11-01', $lte: '2026-11-30' }, tombstone: false, transfer_id: null, 'category.group.is_income': true },
    ]);
    expect(incomeCall.selectExpressions).toEqual([{ amountCents: { $sum: '$amount' } }]);

    const outflowCall = calls.find(
      (c) => c.filterExpressions[0]['category.group.is_income'] === false && !c.filterExpressions[0]['category.group']
    );
    expect(outflowCall.filterExpressions).toEqual([
      { date: { $gte: '2026-11-01', $lte: '2026-11-30' }, tombstone: false, transfer_id: null, 'category.group.is_income': false },
    ]);

    const investmentCall = calls.find((c) => c.filterExpressions[0]['category.group']);
    expect(investmentCall.filterExpressions).toEqual([
      {
        date: { $gte: '2026-11-01', $lte: '2026-11-30' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
        'category.group': { $oneof: ['group1'] },
      },
    ]);
  });
});

test('investmentGroupIds empty/omitted means investmentCents is 0 (adds back nothing)', async () => {
  const client = stubClient((query) => {
    const filter = query.serialize().filterExpressions[0];
    if (filter['category.group.is_income'] === true) return [{ amountCents: 200000 }];
    return [{ amountCents: -100000 }];
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/savings-rate?month=2026-11`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      incomeCents: 200000,
      outflowCents: 100000,
      investmentCents: 0,
      rate: (200000 - 100000 + 0) / 200000,
    });

    // No third query at all when investmentGroupIds is empty -- only the
    // income and outflow sums were ever issued.
    expect(client.aqlQuery).toHaveBeenCalledTimes(2);
  });
});

test("investmentGroupIds restricts which groups' spending counts as investmentCents", async () => {
  const client = stubClient((query) => {
    const filter = query.serialize().filterExpressions[0];
    if (filter['category.group.is_income'] === true) return [{ amountCents: 400000 }];
    if (filter['category.group']) {
      expect(filter['category.group']).toEqual({ $oneof: ['investGroup1', 'investGroup2'] });
      return [{ amountCents: -75000 }];
    }
    return [{ amountCents: -200000 }];
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(
      `${base}/api/savings-rate?month=2026-11&investmentGroupIds=investGroup1,investGroup2`,
      { headers: AUTH_HEADERS }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.investmentCents).toBe(75000);
  });
});

test('an investmentGroupIds entry that does not resolve to a real group is silently omitted, not a 400', async () => {
  const client = stubClient((query) => {
    const filter = query.serialize().filterExpressions[0];
    if (filter['category.group.is_income'] === true) return [{ amountCents: 300000 }];
    if (filter['category.group']) {
      // A nonexistent group id just matches zero transactions -- the AQL
      // $oneof filter naturally yields an empty result set rather than
      // throwing, so the stub mirrors that: no rows means the $sum
      // aggregate still comes back as a single zero-value row.
      return [{ amountCents: 0 }];
    }
    return [{ amountCents: -150000 }];
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(
      `${base}/api/savings-rate?month=2026-11&investmentGroupIds=does-not-exist`,
      { headers: AUTH_HEADERS }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.investmentCents).toBe(0);
  });
});

test('incomeCents of 0 returns rate: null, not NaN or Infinity', async () => {
  const client = stubClient((query) => {
    const filter = query.serialize().filterExpressions[0];
    if (filter['category.group.is_income'] === true) return [{ amountCents: 0 }];
    return [{ amountCents: -50000 }];
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/savings-rate?month=2026-11`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incomeCents).toBe(0);
    expect(body.rate).toBeNull();
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient(() => [{ amountCents: 0 }]));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/savings-rate`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/savings-rate?month=not-a-month`, { headers: AUTH_HEADERS });
    expect(malformed.status).toBe(400);
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue(stubClient(() => [{ amountCents: 0 }]));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/savings-rate?month=2026-11`);
    expect(res.status).toBe(401);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
