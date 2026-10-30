const { computeForecast } = require('../src/forecast/compute');

const NOW = new Date(2026, 9, 30, 7, 0, 0); // 2026-10-30 local
const TODAY = '2026-10-30';

const monthly = (day) => ({ start: `2026-01-${day}`, frequency: 'monthly', interval: 1, patterns: [], skipWeekend: false, weekendSolveMode: 'after', endMode: 'never' });

// 8 weekly outflows of `cents`, one per week (the oldest is 51 days back, so
// 7 full weeks of history are counted).
function history(cents, extra = {}) {
  const out = [];
  for (let w = 0; w < 8; w++) {
    out.push({ id: `t${w}`, date: `2026-${w < 4 ? '10' : '09'}-${String(w < 4 ? 29 - w * 7 : 30 - (w - 4) * 7).padStart(2, '0')}`, amount: -cents, payee: 'p-shop', ...extra });
  }
  return out;
}

function stubClient({ accounts, balances = {}, transactions = {}, schedules = [], payees } = {}) {
  return {
    getAccounts: jest.fn(async () => accounts),
    getAccountBalance: jest.fn(async (id) => {
      const b = balances[id];
      if (b instanceof Error) throw b;
      return b === undefined ? 100000 : b;
    }),
    getTransactions: jest.fn(async (id) => transactions[id] || []),
    getSchedules: jest.fn(async () => schedules),
    getRules: jest.fn(async () => []),
    getCategoryGroups: jest.fn(async () => []),
    aqlQuery: jest.fn(async () => ({
      data: payees || [
        { id: 'p-shop', name: 'Shop' },
        { id: 'p-sb', name: 'starting balance' },
        { id: 'p-rent', name: 'Landlord' },
      ],
    })),
  };
}

const settings = (accounts, extra = {}) => ({ enabled: true, windowDays: 10, time: '07:00', channelId: null, accounts, ...extra });
const acct = (id, extra = {}) => ({ id, name: `Acct ${id}`, offbudget: false, closed: false, ...extra });

test('enabled eligible account gets a projection and allowance from history', async () => {
  const client = stubClient({ accounts: [acct('a1')], transactions: { a1: history(7000) } });
  const r = await computeForecast({ client, now: NOW, settings: settings({ a1: { enabled: true, warningLevelCents: 50000 } }) });
  expect(r.errors).toEqual([]);
  expect(r.results).toHaveLength(1);
  const res = r.results[0];
  expect(res).toMatchObject({ accountId: 'a1', accountName: 'Acct a1', warningLevelCents: 50000, balanceCents: 100000, allowancePerDayCents: 1000, allowanceNote: null });
  expect(res.days).toHaveLength(11);
  expect(res.days[1].balanceCents).toBe(99000);
});

test('off-budget, closed, unknown and disabled accounts are skipped silently', async () => {
  const client = stubClient({ accounts: [acct('off', { offbudget: true }), acct('closed', { closed: true }), acct('dis'), acct('ok')] });
  const r = await computeForecast({
    client,
    now: NOW,
    settings: settings({
      off: { enabled: true, warningLevelCents: 0 },
      closed: { enabled: true, warningLevelCents: 0 },
      ghost: { enabled: true, warningLevelCents: 0 },
      dis: { enabled: false, warningLevelCents: 0 },
      ok: { enabled: true, warningLevelCents: 0 },
    }),
  });
  expect(r.results.map((x) => x.accountId)).toEqual(['ok']);
  expect(r.errors).toEqual([]);
});

test('a failing account goes to errors (message only) and others still compute', async () => {
  const client = stubClient({ accounts: [acct('bad'), acct('good')], balances: { bad: new Error('boom') } });
  const r = await computeForecast({
    client,
    now: NOW,
    settings: settings({ bad: { enabled: true, warningLevelCents: 0 }, good: { enabled: true, warningLevelCents: 0 } }),
  });
  expect(r.errors).toEqual([{ accountId: 'bad', accountName: 'Acct bad', error: 'boom' }]);
  expect(r.results.map((x) => x.accountId)).toEqual(['good']);
});

test('spending at a schedule payee is excluded from the allowance', async () => {
  const txns = [...history(7000), ...history(7000, { payee: 'p-rent' }).map((t) => ({ ...t, id: `r${t.id}` }))];
  const schedules = [{ id: 's1', completed: false, amount: -5000, payee: 'p-rent', account: 'a1', date: monthly('20'), next_date: '2026-11-20' }];
  const client = stubClient({ accounts: [acct('a1')], transactions: { a1: txns }, schedules });
  const r = await computeForecast({ client, now: NOW, settings: settings({ a1: { enabled: true, warningLevelCents: 0 } }) });
  expect(r.results[0].allowancePerDayCents).toBe(1000);
});

test('Starting Balance, Balance Adjustment and Reconciliation payees are excluded from the allowance', async () => {
  const payees = [
    { id: 'p-shop', name: 'Shop' },
    { id: 'p-sb', name: 'starting balance' },
    { id: 'p-adj', name: 'Balance Adjustment' },
    { id: 'p-rec', name: 'RECONCILIATION TRANSACTION' },
  ];
  const txns = [
    ...history(7000),
    ...history(900000, { payee: 'p-sb' }).map((t) => ({ ...t, id: `sb${t.id}` })),
    ...history(900000, { payee: 'p-adj' }).map((t) => ({ ...t, id: `adj${t.id}` })),
    ...history(900000, { payee: 'p-rec' }).map((t) => ({ ...t, id: `rec${t.id}` })),
  ];
  const client = stubClient({ accounts: [acct('a1')], transactions: { a1: txns }, payees });
  const r = await computeForecast({ client, now: NOW, settings: settings({ a1: { enabled: true, warningLevelCents: 0 } }) });
  expect(r.results[0].allowancePerDayCents).toBe(1000);
});

test("another account's occurrences stay out of an account's events and days", async () => {
  const schedules = [
    { id: 's1', completed: false, amount: -1000, payee: 'p-rent', account: 'a1', date: '2026-11-02', next_date: '2026-11-02' },
    { id: 's2', completed: false, amount: -50000, payee: 'p-rent', account: 'a2', date: '2026-11-03', next_date: '2026-11-03' },
  ];
  const client = stubClient({ accounts: [acct('a1'), acct('a2')], schedules, balances: { a1: 100000, a2: 100000 } });
  const r = await computeForecast({
    client,
    now: NOW,
    settings: settings({ a1: { enabled: true, warningLevelCents: 0 }, a2: { enabled: true, warningLevelCents: 0 } }),
  });
  const [one, two] = r.results;
  expect(one.events).toEqual([{ date: '2026-11-02', name: 'Landlord', amountCents: -1000 }]);
  expect(one.days[10].balanceCents).toBe(99000);
  expect(two.events).toEqual([{ date: '2026-11-03', name: 'Landlord', amountCents: -50000 }]);
  expect(two.days[10].balanceCents).toBe(50000);
});

test('uses settings.windowDays, warning level, and schedules for the projection', async () => {
  const schedules = [{ id: 's1', completed: false, amount: -90000, payee: 'p-rent', account: 'a1', date: '2026-11-03', next_date: '2026-11-03' }];
  const client = stubClient({ accounts: [acct('a1')], schedules, balances: { a1: 100000 } });
  const r = await computeForecast({ client, now: NOW, settings: settings({ a1: { enabled: true, warningLevelCents: 20000 } }, { windowDays: 5 }) });
  const res = r.results[0];
  expect(r.windowDays).toBe(5);
  expect(res.days).toHaveLength(6);
  expect(res.breach).toMatchObject({ date: '2026-11-03', balanceCents: 10000, shortfallCents: 10000 });
  expect(res.events).toEqual([{ date: '2026-11-03', name: 'Landlord', amountCents: -90000 }]);
});

test('generatedAt and today come from now; transactions fetched 12 weeks back to yesterday', async () => {
  const client = stubClient({ accounts: [acct('a1')] });
  const r = await computeForecast({ client, now: NOW, settings: settings({ a1: { enabled: true, warningLevelCents: 0 } }) });
  expect(r.generatedAt).toBe(NOW.toISOString());
  expect(r.today).toBe(TODAY);
  expect(client.getTransactions).toHaveBeenCalledWith('a1', '2026-08-07', '2026-10-29');
  expect(client.getSchedules).toHaveBeenCalledTimes(1);
});
