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

function stubClient({ schedules = [], payees = [] } = {}) {
  return {
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
  // Pin "today" to 2026-10-26 instead of relying on the real wall clock —
  // this endpoint's logic inherently depends on "today" (to derive the
  // current/next month), so it must be pinned explicitly rather than
  // inheriting the real-wall-clock fragility budget-pacing.test.js relies on.
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local (month is 0-indexed)
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

// "Today" is pinned to 2026-10-26, so currentMonth = '2026-10' and
// nextMonth = '2026-11' throughout this file.

test('a biweekly income schedule alerts for a month with 3 occurrences (average ~2.17/month)', async () => {
  // Biweekly starting well before the trailing-12-month window: October 2026
  // has 3 occurrences (Oct 2, 16, 30) against a steady 26/12 ≈ 2.17/month
  // average, so it alerts for October. November 2026 has only 2 occurrences
  // (below average), so it does not alert there.
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Biweekly Paycheck', completed: false, amount: 200000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({
      scheduleId: 'sched1',
      scheduleName: 'Biweekly Paycheck',
      month: '2026-10',
      occurrences: 3,
      amountPerOccurrenceCents: 200000,
    });
    expect(body.alerts[0].averagePerMonth).toBeCloseTo(26 / 12, 10);
  });
});

test('a perfectly regular monthly income schedule (average exactly 1.0) never alerts', async () => {
  const config = { frequency: 'monthly', start: '2020-01-15', patterns: [{ type: 'day', value: 15 }] };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Monthly Salary', completed: false, amount: 500000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('checks both current and next month independently', async () => {
  // Same biweekly schedule as the first test: alerts for October (3
  // occurrences) but not for November (2 occurrences) — proving both months
  // are evaluated on their own, not just whichever comes first.
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Biweekly Paycheck', completed: false, amount: 200000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();

    const months = body.alerts.map((a) => a.month);
    expect(months).toEqual(['2026-10']);
    expect(months).not.toContain('2026-11');
  });
});

test('a completed schedule never alerts', async () => {
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Biweekly Paycheck', completed: true, amount: 200000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('a one-time (non-recurring) schedule is excluded, not treated as a 1-per-forever cadence', async () => {
  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        {
          id: 'sched1',
          name: 'One-time Bonus',
          completed: false,
          amount: 100000,
          payee: 'payeeA',
          date: '2026-10-15',
          next_date: '2026-10-15',
        },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('a negative-amount (non-income) recurring schedule never alerts', async () => {
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Biweekly Rent', completed: false, amount: -200000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test("a transfer schedule with a positive amount (e.g. cc-helper's checking->card autopay) never alerts even if recurring", async () => {
  // Same biweekly cadence/amount as the first test, which would otherwise
  // qualify for an October alert — the transfer-payee exclusion must be what
  // suppresses it.
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      payees: [{ id: 'transferPayee', transfer_acct: 'acctXYZ' }],
      schedules: [
        {
          id: 'sched1',
          name: 'Checking->Card Autopay',
          completed: false,
          amount: 200000,
          payee: 'transferPayee',
          date: config,
        },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('a perfectly regular monthly schedule that started only 2 months ago never alerts (short-history regression)', async () => {
  // Started 2026-09-15 - only ~2 months before "today" (2026-10-26). The
  // original bug divided occurrencesInYear by a fixed 12 regardless of how
  // much history existed, producing an artificially low average (0.17 for
  // October, 0.25 for November) that false-alerted even for this perfectly
  // regular 1/month cadence.
  const config = { frequency: 'monthly', start: '2026-09-15', patterns: [{ type: 'day', value: 15 }] };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'New Monthly Salary', completed: false, amount: 500000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('a perfectly regular monthly schedule that started 10 months ago never alerts', async () => {
  // Started 2025-12-15 - about 10 months before "today" (2026-10-26). Still
  // less than a full 12-month trailing history, so this exercises the same
  // short-history averaging-window logic with a longer (but still partial)
  // history.
  const config = { frequency: 'monthly', start: '2025-12-15', patterns: [{ type: 'day', value: 15 }] };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'Monthly Salary', completed: false, amount: 500000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});

test('a biweekly schedule that started only 2 months ago still alerts correctly for a 3-occurrence month', async () => {
  // Started 2026-09-04 - confirms the short-history fix doesn't break the
  // legitimate alerting case: a short-but-sufficient history should still
  // produce a correct (non-1.0) average and alert when a month has more than
  // the normal number of occurrences.
  const config = { frequency: 'weekly', interval: 2, start: '2026-09-04' };

  getActualClient.mockResolvedValue(
    stubClient({
      schedules: [
        { id: 'sched1', name: 'New Biweekly Paycheck', completed: false, amount: 200000, payee: 'payeeA', date: config },
      ],
      payees: [],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Biweekly from 2026-09-04: Sep 4/18, Oct 2/16/30 (3 occurrences in
    // October), Nov 13/27 (2 occurrences in November).
    const octAlert = body.alerts.find((a) => a.month === '2026-10');
    expect(octAlert).toBeDefined();
    expect(octAlert.occurrences).toBe(3);
    expect(octAlert.averagePerMonth).toBeLessThan(3);
    expect(octAlert.averagePerMonth).toBeGreaterThan(0);

    const novAlert = body.alerts.find((a) => a.month === '2026-11');
    expect(novAlert).toBeUndefined();
  });
});

test('falls back to the payee name when schedule.name is missing', async () => {
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      payees: [{ id: 'payeeA', name: 'Acme Employer' }],
      schedules: [
        { id: 'sched1', name: null, completed: false, amount: 200000, payee: 'payeeA', date: config },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].scheduleName).toBe('Acme Employer');
  });
});

test('falls back to a generic label when neither schedule.name nor a resolvable payee is available', async () => {
  const config = { frequency: 'weekly', interval: 2, start: '2020-01-03' };

  getActualClient.mockResolvedValue(
    stubClient({
      payees: [],
      schedules: [
        { id: 'sched1', name: null, completed: false, amount: 200000, payee: 'missingPayee', date: config },
      ],
    })
  );

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].scheduleName).toBe('(Unnamed schedule)');
  });
});

test('no qualifying schedules returns an empty alerts array, not an error', async () => {
  getActualClient.mockResolvedValue(stubClient({ schedules: [], payees: [] }));

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/paycheck-alerts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });
});
