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

// Same stubbing pattern as spending-breakdown.test.js: `aqlQuery` is keyed by
// table name since the route uses the real (unmocked) `q()` builder from
// `@actual-app/api` to fetch payees. `getSchedules` is a plain client method
// (this endpoint reads schedules directly, not via AQL).
function stubClient({ schedules = [], payees = [] } = {}) {
  return {
    getSchedules: jest.fn(async () => schedules),
    aqlQuery: jest.fn(async (query) => {
      const table = query.serialize().table;
      if (table === 'payees') return { data: payees };
      throw new Error(`stubClient: no stubbed response for table "${table}"`);
    }),
  };
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  process.env.TZ = 'America/Denver';
  // Pin "today" to 2026-10-26, same as paycheck-alerts.test.js — this
  // endpoint's "upcoming" filter depends on "today".
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local (month is 0-indexed)
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

test('lists a one-time schedule whose next_date falls in the remaining days of the month', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: -5000,
          payee: 'payeeA',
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
      ],
      payees: [{ id: 'payeeA', name: 'Acme Gym' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { scheduleId: 'sched1', payeeName: 'Acme Gym', date: '2026-10-30', amountCents: -5000 },
    ]);
  });
});

test('lists a recurring schedule once per occurrence date within the remaining days', async () => {
  // Weekly from 2026-10-01: occurrences Oct 1, 8, 15, 22, 29. Only Oct 29
  // falls within [today (Oct 26), monthEnd (Oct 31)].
  const config = { frequency: 'weekly', start: '2026-10-01' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: false, amount: -2000, payee: 'payeeA', date: config },
      ],
      payees: [{ id: 'payeeA', name: 'Streaming Service' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { scheduleId: 'sched1', payeeName: 'Streaming Service', date: '2026-10-29', amountCents: -2000 },
    ]);
  });
});

test('items are sorted chronologically across interleaved schedules', async () => {
  const weeklyConfig = { frequency: 'weekly', start: '2026-10-01' }; // occurrence Oct 29 in range

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'onetime',
          completed: false,
          amount: -3000,
          payee: 'payeeA',
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
        { id: 'recurring', completed: false, amount: -2000, payee: 'payeeB', date: weeklyConfig },
      ],
      payees: [
        { id: 'payeeA', name: 'Later Payee' },
        { id: 'payeeB', name: 'Earlier Payee' },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.items.map((item) => item.date)).toEqual(['2026-10-29', '2026-10-30']);
  });
});

test('a completed schedule never appears', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: true,
          amount: -5000,
          payee: 'payeeA',
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
      ],
      payees: [{ id: 'payeeA', name: 'Acme Gym' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

test('a schedule with no payee renders "(No payee)"', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: -5000,
          payee: null,
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].payeeName).toBe('(No payee)');
  });
});

test('a {num1, num2} amount range is resolved via resolveScheduledAmount, not left as an object', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: { num1: -1000, num2: -2000 },
          payee: 'payeeA',
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
      ],
      payees: [{ id: 'payeeA', name: 'Variable Bill' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amountCents).toBe(-1500);
  });
});

test('a positive-amount (income-like) schedule appears with its positive amountCents unchanged — no negation', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: 150000,
          payee: 'payeeA',
          date: '2026-10-30',
          next_date: '2026-10-30',
        },
      ],
      payees: [{ id: 'payeeA', name: 'Employer' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amountCents).toBe(150000);
  });
});

test('an entirely past month returns an empty items array, not an error', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: -5000,
          payee: 'payeeA',
          date: '2026-09-15',
          next_date: '2026-09-15',
        },
      ],
      payees: [{ id: 'payeeA', name: 'Acme Gym' }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bills-timeline?month=2026-09`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient());

  await withServer(async (base) => {
    const resMissing = await fetch(`${base}/api/bills-timeline`, { headers: AUTH_HEADERS });
    expect(resMissing.status).toBe(400);

    const resMalformed = await fetch(`${base}/api/bills-timeline?month=2026/10`, { headers: AUTH_HEADERS });
    expect(resMalformed.status).toBe(400);
  });
});
