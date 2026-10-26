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
});

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// "Today" in this test run is 2026-10-26 (per the environment's clock), so
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

test('a missing or malformed month 400s', async () => {
  getActualClient.mockResolvedValue(stubClient({}));

  await withServer(async (base) => {
    const missing = await fetch(`${base}/api/month-end-projection`, { headers: AUTH_HEADERS });
    expect(missing.status).toBe(400);

    const malformed = await fetch(`${base}/api/month-end-projection?month=not-a-month`, { headers: AUTH_HEADERS });
    expect(malformed.status).toBe(400);
  });
});
