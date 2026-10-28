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
  if (syncIfDue && syncIfDue.mockReset) syncIfDue.mockReset();
  if (syncIfDue && syncIfDue.mockResolvedValue) syncIfDue.mockResolvedValue();
});

test('returns one entry per day in range, filling $0 for days with no spending', async () => {
  const client = stubClient({
    transactions: [
      { date: '2026-11-02', amountCents: -2500 },
      { date: '2026-11-04', amountCents: -1000 },
    ],
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-calendar?start=2026-11-01&end=2026-11-05`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      days: [
        { date: '2026-11-01', amountCents: 0 },
        { date: '2026-11-02', amountCents: 2500 },
        { date: '2026-11-03', amountCents: 0 },
        { date: '2026-11-04', amountCents: 1000 },
        { date: '2026-11-05', amountCents: 0 },
      ],
    });
  });
});

test('excludes transfers and income the same way spending-breakdown does (assert on the serialized AQL filter)', async () => {
  const client = stubClient({
    transactions: [{ date: '2026-11-02', amountCents: -2500 }],
  });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    await fetch(`${base}/api/spending-calendar?start=2026-11-01&end=2026-11-05`, { headers: AUTH_HEADERS });

    const serialized = serializedQueryFor(client, 'transactions');
    expect(serialized.filterExpressions).toEqual([
      {
        date: { $gte: '2026-11-01', $lte: '2026-11-05' },
        tombstone: false,
        transfer_id: null,
        'category.group.is_income': false,
      },
    ]);
    expect(serialized.groupExpressions).toEqual(['date']);
    expect(serialized.selectExpressions).toEqual([{ date: 'date' }, { amountCents: { $sum: '$amount' } }]);
  });
});

test('a range of exactly 366 days is allowed', async () => {
  const client = stubClient({ transactions: [] });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    // 2027-01-01 through 2028-01-01 inclusive is exactly 366 days.
    const res = await fetch(`${base}/api/spending-calendar?start=2027-01-01&end=2028-01-01`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toHaveLength(366);
  });
});

test('a range longer than 366 days 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    // 2027-01-01 through 2028-01-02 inclusive is 367 days.
    const res = await fetch(`${base}/api/spending-calendar?start=2027-01-01&end=2028-01-02`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'start and end must be at most 366 days apart' });
  });
});

test('start after end 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-calendar?start=2026-11-05&end=2026-11-01`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'start must be on or before end' });
  });
});

test('missing or malformed start/end 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const missingStart = await fetch(`${base}/api/spending-calendar?end=2026-11-05`, { headers: AUTH_HEADERS });
    expect(missingStart.status).toBe(400);
    expect(await missingStart.json()).toEqual({ error: 'start and end query parameters must be in YYYY-MM-DD format' });

    const missingEnd = await fetch(`${base}/api/spending-calendar?start=2026-11-01`, { headers: AUTH_HEADERS });
    expect(missingEnd.status).toBe(400);

    const malformedStart = await fetch(`${base}/api/spending-calendar?start=not-a-date&end=2026-11-05`, {
      headers: AUTH_HEADERS,
    });
    expect(malformedStart.status).toBe(400);

    const malformedEnd = await fetch(`${base}/api/spending-calendar?start=2026-11-01&end=11-2026-05`, {
      headers: AUTH_HEADERS,
    });
    expect(malformedEnd.status).toBe(400);
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/spending-calendar?start=2026-11-01&end=2026-11-05`);
    expect(res.status).toBe(401);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
