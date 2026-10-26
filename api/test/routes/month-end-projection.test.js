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

function stubClient({ categoryGroups = [], schedules = [], payees = [], totalIncome = 0, totalSpent = 0 } = {}) {
  return {
    getBudgetMonth: jest.fn(async (month) => ({ month, categoryGroups, totalIncome, totalSpent })),
    getSchedules: jest.fn(async () => schedules),
    getPayees: jest.fn(async () => payees),
  };
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  process.env.TZ = 'America/Denver';
  // Pin "today" instead of relying on the real wall clock (final-review Fix
  // 4) — this file's tests are written against a specific "today" of
  // 2026-10-26, and without pinning they'll start failing once the real date
  // moves past the test month. `doNotFake` keeps the real HTTP
  // fetch/server-listening machinery `withServer` relies on working.
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local (month is 0-indexed)
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

// "Today" in this test run is pinned to 2026-10-26 (see beforeEach), so
// 2026-10 is the in-progress month: daysElapsed=26, daysInMonth=31,
// remainingDays=5.

test('sums income so far + remaining scheduled income - spent so far - trended remaining spending', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      totalIncome: 500000,
      totalSpent: -100000, // Actual's negative-outflow convention; spentSoFar = 100000
      categoryGroups: [
        {
          id: 'group1',
          name: 'Everyday Expenses',
          is_income: false,
          categories: [{ id: 'catA', name: 'Groceries', budgeted: 30000, spent: -13000 }],
        },
      ],
      schedules: [],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    // catA: spent=13000, daysElapsed=26, remainingDays=5, budgeted=30000
    // dailyRate = 13000/26 = 500; projectedTotal = 13000 + 500*5 = 15500
    // under budget (15500 <= 30000), no cap needed; contribution = max(0, 15500-13000) = 2500
    expect(body).toMatchObject({
      month: '2026-10',
      components: {
        incomeSoFarCents: 500000,
        remainingScheduledIncomeCents: 0,
        spentSoFarCents: 100000,
        trendedRemainingSpendingCents: 2500,
      },
      projectedNetCents: 500000 + 0 - 100000 - 2500,
    });
  });
});

test('an already-over-budget category is not capped at its budgeted amount', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      categoryGroups: [
        {
          id: 'group1',
          name: 'Everyday Expenses',
          is_income: false,
          // spent (26000) already exceeds budgeted (20000)
          categories: [{ id: 'catA', name: 'Dining', budgeted: 20000, spent: -26000 }],
        },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();

    // dailyRate = 26000/26 = 1000; projectedTotal = 26000 + 1000*5 = 31000, not capped
    // contribution = max(0, 31000-26000) = 5000
    expect(body.components.trendedRemainingSpendingCents).toBe(5000);
  });
});

test("an at/under-budget category's trended spending is capped at its budgeted amount", async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      categoryGroups: [
        {
          id: 'group1',
          name: 'Everyday Expenses',
          is_income: false,
          // spent (13000) is under budgeted (14000); uncapped projection would exceed budgeted
          categories: [{ id: 'catA', name: 'Groceries', budgeted: 14000, spent: -13000 }],
        },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();

    // dailyRate = 13000/26 = 500; projectedTotal = 13000 + 500*5 = 15500 -> capped at 14000
    // contribution = max(0, 14000-13000) = 1000
    expect(body.components.trendedRemainingSpendingCents).toBe(1000);
  });
});

test('daysElapsed=0 (the 1st of the month) contributes 0 trended spending, no divide-by-zero', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      categoryGroups: [
        {
          id: 'group1',
          name: 'Everyday Expenses',
          is_income: false,
          categories: [{ id: 'catA', name: 'Groceries', budgeted: 10000, spent: 0 }],
        },
      ],
    })
  );

  await withServer(async (base) => {
    // 2026-11 is a future month relative to the test clock (2026-10-26) -> daysElapsed=0
    const res = await fetch(`${base}/api/month-end-projection?month=2026-11`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.components.trendedRemainingSpendingCents).toBe(0);
  });
});

test("a one-time (non-recurring) income schedule is only counted if its next_date falls in the remaining days", async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: false, amount: 50000, payee: 'payeeA', date: '2026-10-28', next_date: '2026-10-28' },
        { id: 'sched2', completed: false, amount: 60000, payee: 'payeeA', date: '2026-09-15', next_date: '2026-09-15' },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    // only sched1's next_date (2026-10-28) falls within [today, monthEnd]
    expect(body.components.remainingScheduledIncomeCents).toBe(50000);
  });
});

test('a completed schedule is excluded entirely', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: true, amount: 50000, payee: 'payeeA', date: '2026-10-28', next_date: '2026-10-28' },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(0);
  });
});

test('a negative-amount (non-income) schedule does not contribute to remaining scheduled income', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: false, amount: -5000, payee: 'payeeA', date: '2026-10-28', next_date: '2026-10-28' },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(0);
  });
});

test("a transfer schedule with a positive amount (e.g. cc-helper's checking->card autopay) does not contribute to remaining scheduled income", async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      payees: [{ id: 'transferPayee', transfer_acct: 'acctXYZ' }],
      schedules: [
        {
          id: 'sched1',
          completed: false,
          amount: 50000,
          payee: 'transferPayee',
          date: '2026-10-28',
          next_date: '2026-10-28',
        },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(0);
  });
});

test('a one-time schedule due TODAY is counted regardless of the current wall-clock time of day (final-review Fix 2)', async () => {
  // The pinned clock is 2026-10-26 10:00 local. A one-time schedule's
  // next_date is date-only (no time-of-day), so before the fix, comparing it
  // against `new Date()` (today's actual time-of-day) meant a schedule due
  // today was NEVER counted — its parsed local midnight is always earlier
  // than "now".
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: false, amount: 25000, payee: 'payeeA', date: '2026-10-26', next_date: '2026-10-26' },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(25000);
  });
});

test("a recurring schedule's occurrence TODAY is counted regardless of what time the request runs (final-review Fix 2)", async () => {
  // Run the same scenario with the pinned clock both before and after noon
  // (recurrence.js generates recurring occurrences at local noon): before the
  // fix, using the unnormalized `new Date()` as the range start meant the
  // answer flipped depending on which side of noon "now" happened to fall.
  const config = {
    frequency: 'weekly',
    start: '2026-10-26', // a Monday; pinned "today"
  };

  for (const hour of [8, 16]) {
    jest.useFakeTimers({
      now: new Date(2026, 9, 26, hour),
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
    });

    getActualClient.mockReset();
    getActualClient.mockResolvedValue(
      stubClient({
        schedules: [{ id: 'sched1', completed: false, amount: 40000, payee: 'payeeA', date: config }],
        payees: [],
      })
    );

    // eslint-disable-next-line no-await-in-loop
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
      const body = await res.json();
      expect(body.components.remainingScheduledIncomeCents).toBe(40000);
    });
  }
});

test('a recurring monthly schedule occurring on the LAST DAY of the projection month is counted (final-review Fix 1, Critical)', async () => {
  // October has 31 days. Before the fix, the month-end boundary used local
  // midnight of the 31st, but recurrence.js generates the occurrence at local
  // noon on the 31st — after midnight — so it was silently dropped.
  const config = {
    frequency: 'monthly',
    start: '2026-10-31',
    patterns: [{ type: 'day', value: 31 }],
  };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [{ id: 'sched1', completed: false, amount: 70000, payee: 'payeeA', date: config }],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(70000);
  });
});

test("a schedule whose occurrence shifts into the PRIOR month (weekendSolveMode 'before') is counted in that prior month, not double-counted or leaked into the next (final-review Fix 3)", async () => {
  // 2026-11-01 is a Sunday. The natural occurrence is in November, but
  // weekendSolveMode 'before' shifts it back to Friday 2026-10-30 — it should
  // count toward October's projection.
  const config = {
    frequency: 'monthly',
    start: '2026-11-01',
    patterns: [{ type: 'day', value: 1 }],
    skipWeekend: true,
    weekendSolveMode: 'before',
  };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [{ id: 'sched1', completed: false, amount: 90000, payee: 'payeeA', date: config }],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(90000);
  });
});

test('a future-month request only counts scheduled income within the requested month, not the rest of the current month too (final-review Fix 8)', async () => {
  // "Today" is pinned to 2026-10-26. A schedule due 2026-10-28 (later this
  // month, but before the requested 2026-11 month starts) must NOT count
  // toward a 2026-11 request.
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', completed: false, amount: 50000, payee: 'payeeA', date: '2026-10-28', next_date: '2026-10-28' },
        { id: 'sched2', completed: false, amount: 60000, payee: 'payeeA', date: '2026-11-15', next_date: '2026-11-15' },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-11`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(60000);
  });
});

test('a RECURRING income schedule is counted end-to-end through the route (final-review Fix 10)', async () => {
  const config = {
    frequency: 'weekly',
    start: '2026-10-05',
  };
  // Weekly from Oct 5: occurrences on Oct 5, 12, 19, 26 within October.
  // rangeStart is pinned "today" 2026-10-26, so only the Oct 26 occurrence is
  // within [rangeStart, monthEnd].

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [{ id: 'sched1', completed: false, amount: 45000, payee: 'payeeA', date: config }],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(45000);
  });
});

test('a RECURRING transfer schedule with a positive amount does not contribute to remaining scheduled income (final-review Fix 10)', async () => {
  const config = {
    frequency: 'weekly',
    start: '2026-10-26',
  };

  getActualClient.mockResolvedValue(
    stubClient({
      payees: [{ id: 'transferPayee', transfer_acct: 'acctXYZ' }],
      schedules: [{ id: 'sched1', completed: false, amount: 45000, payee: 'transferPayee', date: config }],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/month-end-projection?month=2026-10`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.components.remainingScheduledIncomeCents).toBe(0);
  });
});

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/month-end-projection`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/month-end-projection?month=not-a-month`, { headers: AUTH_HEADERS });
    expect(malformed.status).toBe(400);
  });
});
