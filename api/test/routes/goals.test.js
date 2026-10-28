jest.mock('../../src/actual-client');
jest.mock('../../src/auth');
jest.mock('../../src/goals-store');

const { getActualClient } = require('../../src/actual-client');
const { validateToken } = require('../../src/auth');
const { readGoals, writeGoals } = require('../../src/goals-store');

const AUTH_HEADERS = { 'X-ACTUAL-TOKEN': 'valid-test-token' };
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

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

// Fakes getCategoryGroups()/getAccounts()/getBudgetMonth() just enough to
// exercise resolution + the carryover check, the same shape
// budget-pacing.test.js and spending-breakdown.test.js already use for their
// own client stubs.
function stubClient({ categoryGroups = [], accounts = [], budgetMonthCategoryGroups = [] } = {}) {
  return {
    getCategoryGroups: jest.fn(async () => categoryGroups),
    getAccounts: jest.fn(async () => accounts),
    getBudgetMonth: jest.fn(async (month) => ({ month, categoryGroups: budgetMonthCategoryGroups })),
  };
}

const VALID_ACCOUNT_BODY = {
  entityType: 'account',
  entityId: 'accA',
  targetAmountCents: 500000,
  targetDate: '2026-12-25',
};

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  readGoals.mockReset();
  writeGoals.mockReset();
  writeGoals.mockResolvedValue(undefined);
});

test('GET /api/goals returns the stored list', async () => {
  const goals = [{ id: 'g1', entityType: 'account', entityId: 'accA', targetAmountCents: 500000, targetDate: '2026-12-25' }];
  readGoals.mockResolvedValue(goals);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals });
  });
});

test('PUT /api/goals/:id creates a new goal when :id is unseen', async () => {
  readGoals.mockResolvedValue([]);
  getActualClient.mockResolvedValue(stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] }));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_ACCOUNT_BODY),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goal: { id: 'g1', ...VALID_ACCOUNT_BODY } });
    expect(writeGoals).toHaveBeenCalledWith([{ id: 'g1', ...VALID_ACCOUNT_BODY }]);
  });
});

test('PUT /api/goals/:id replaces an existing goal with the same id', async () => {
  const existing = { id: 'g1', entityType: 'account', entityId: 'accOld', targetAmountCents: 100, targetDate: '2026-01-01' };
  readGoals.mockResolvedValue([existing]);
  getActualClient.mockResolvedValue(stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] }));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_ACCOUNT_BODY),
    });
    expect(res.status).toBe(200);
    expect(writeGoals).toHaveBeenCalledWith([{ id: 'g1', ...VALID_ACCOUNT_BODY }]);
  });
});

test('PUT rejects entityType outside category/account with 400', async () => {
  readGoals.mockResolvedValue([]);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, entityType: 'payee' }),
    });
    expect(res.status).toBe(400);
    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('PUT rejects a non-positive-integer targetAmountCents with 400', async () => {
  readGoals.mockResolvedValue([]);

  await withServer(async (base) => {
    const zero = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, targetAmountCents: 0 }),
    });
    expect(zero.status).toBe(400);

    const negative = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, targetAmountCents: -500 }),
    });
    expect(negative.status).toBe(400);

    const fractional = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, targetAmountCents: 12.5 }),
    });
    expect(fractional.status).toBe(400);

    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('PUT rejects a malformed targetDate with 400', async () => {
  readGoals.mockResolvedValue([]);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, targetDate: '12/25/2026' }),
    });
    expect(res.status).toBe(400);
    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('PUT rejects entityType: category whose entityId does not resolve to a real category, 400', async () => {
  readGoals.mockResolvedValue([]);
  getActualClient.mockResolvedValue(
    stubClient({ categoryGroups: [{ id: 'group1', categories: [{ id: 'catOther', name: 'Other' }] }] })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ entityType: 'category', entityId: 'catMissing', targetAmountCents: 1000, targetDate: '2026-12-25' }),
    });
    expect(res.status).toBe(400);
    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('PUT rejects entityType: category whose category has carryover disabled, 400', async () => {
  readGoals.mockResolvedValue([]);
  getActualClient.mockResolvedValue(
    stubClient({
      categoryGroups: [{ id: 'group1', categories: [{ id: 'catA', name: 'Vacation' }] }],
      budgetMonthCategoryGroups: [{ id: 'group1', categories: [{ id: 'catA', carryover: false }] }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ entityType: 'category', entityId: 'catA', targetAmountCents: 1000, targetDate: '2026-12-25' }),
    });
    expect(res.status).toBe(400);
    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('PUT accepts entityType: category whose category has carryover enabled', async () => {
  readGoals.mockResolvedValue([]);
  getActualClient.mockResolvedValue(
    stubClient({
      categoryGroups: [{ id: 'group1', categories: [{ id: 'catA', name: 'Vacation' }] }],
      budgetMonthCategoryGroups: [{ id: 'group1', categories: [{ id: 'catA', carryover: true }] }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ entityType: 'category', entityId: 'catA', targetAmountCents: 1000, targetDate: '2026-12-25' }),
    });
    expect(res.status).toBe(200);
    expect(writeGoals).toHaveBeenCalled();
  });
});

test('PUT accepts entityType: account without any carryover check', async () => {
  readGoals.mockResolvedValue([]);
  const client = stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] });
  getActualClient.mockResolvedValue(client);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_ACCOUNT_BODY),
    });
    expect(res.status).toBe(200);
    expect(client.getBudgetMonth).not.toHaveBeenCalled();
  });
});

test('PUT allows a targetDate in the past (not rejected)', async () => {
  readGoals.mockResolvedValue([]);
  getActualClient.mockResolvedValue(stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] }));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...VALID_ACCOUNT_BODY, targetDate: '2000-01-01' }),
    });
    expect(res.status).toBe(200);
  });
});

test('two concurrent PUTs: the second write wins, file is never left corrupt', async () => {
  // A stateful fake standing in for the real (file-backed) store: readGoals
  // always sees the latest committed state, and writeGoals commits after an
  // artificial delay so both in-flight requests' read-modify-write cycles
  // actually overlap. goals-store.test.js already covers the real store's
  // own atomicity; this exercises the route's read-then-write race on top of
  // it -- the last write to *complete* replaces the whole list outright, it
  // is never merged with the other request's goal and the array is never
  // left truncated or partially written.
  let stored = [];
  readGoals.mockImplementation(async () => stored);
  writeGoals.mockImplementation(async (goals) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    stored = goals;
  });
  getActualClient.mockResolvedValue(stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] }));

  await withServer(async (base) => {
    const bodyA = { entityType: 'account', entityId: 'accA', targetAmountCents: 1000, targetDate: '2026-01-01' };
    const bodyB = { entityType: 'account', entityId: 'accA', targetAmountCents: 2000, targetDate: '2026-02-01' };

    const [resA, resB] = await Promise.all([
      fetch(`${base}/api/goals/g1`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(bodyA) }),
      fetch(`${base}/api/goals/g1`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(bodyB) }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Exactly one goal survives, intact -- whichever write completed last --
    // never both, never a mix of the two.
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('g1');
    expect([1000, 2000]).toContain(stored[0].targetAmountCents);
  });
});

test('two concurrent PUTs for different goal ids: both survive', async () => {
  // Unlike the same-id race above, this exercises the route's own
  // serialization of its read-modify-write section: two PUTs for two
  // *different* ids landing close together (ordinary single-tab use, e.g.
  // editing two different goals in quick succession) must not each read
  // the same stored list and clobber each other's write -- both goals
  // must survive, even though both requests still return 200.
  let stored = [];
  readGoals.mockImplementation(async () => stored);
  writeGoals.mockImplementation(async (goals) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    stored = goals;
  });
  getActualClient.mockResolvedValue(stubClient({ accounts: [{ id: 'accA', name: 'Checking' }] }));

  await withServer(async (base) => {
    const bodyA = { entityType: 'account', entityId: 'accA', targetAmountCents: 1000, targetDate: '2026-01-01' };
    const bodyB = { entityType: 'account', entityId: 'accA', targetAmountCents: 2000, targetDate: '2026-02-01' };

    const [resA, resB] = await Promise.all([
      fetch(`${base}/api/goals/g1`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(bodyA) }),
      fetch(`${base}/api/goals/g2`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(bodyB) }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(stored).toHaveLength(2);
    expect(stored.find((g) => g.id === 'g1')?.targetAmountCents).toBe(1000);
    expect(stored.find((g) => g.id === 'g2')?.targetAmountCents).toBe(2000);
  });
});

test('DELETE /api/goals/:id removes it; 404 if the id does not exist', async () => {
  readGoals.mockResolvedValue([{ id: 'g1', entityType: 'account', entityId: 'accA', targetAmountCents: 100, targetDate: '2026-01-01' }]);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, { method: 'DELETE', headers: AUTH_HEADERS });
    expect(res.status).toBe(204);
    expect(writeGoals).toHaveBeenCalledWith([]);
  });
});

test('DELETE /api/goals/:id 404s if the id does not exist', async () => {
  readGoals.mockResolvedValue([{ id: 'g1', entityType: 'account', entityId: 'accA', targetAmountCents: 100, targetDate: '2026-01-01' }]);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g-missing`, { method: 'DELETE', headers: AUTH_HEADERS });
    expect(res.status).toBe(404);
    expect(writeGoals).not.toHaveBeenCalled();
  });
});

test('401s with no token', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals`);
    expect(res.status).toBe(401);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
