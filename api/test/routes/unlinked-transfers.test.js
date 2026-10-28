jest.mock('../../src/actual-client');
jest.mock('../../src/auth');

const { getActualClient, syncIfDue } = require('../../src/actual-client');
const { validateToken } = require('../../src/auth');
const { findUnlinkedTransferCandidates } = require('../../src/routes/unlinked-transfers');

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

function stubClient({ accounts = [], transactionsByAccount = {} } = {}) {
  return {
    getAccounts: jest.fn(async () => accounts),
    getTransactions: jest.fn(async (accountId) => transactionsByAccount[accountId] || []),
  };
}

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  syncIfDue.mockReset?.();
  if (syncIfDue && syncIfDue.mockResolvedValue) syncIfDue.mockResolvedValue();
  process.env.TZ = 'America/Denver';
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10), // 2026-10-26, 10:00 local
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});

describe('findUnlinkedTransferCandidates (pure matching logic)', () => {
  test('flags an unlinked opposite-amount pair across accounts within the 3-day window', () => {
    const byAccount = new Map([
      ['checking', [{ id: 'c1', account: 'checking', amount: -40905, date: '2026-08-24', transfer_id: null, tombstone: false }]],
      ['card', [{ id: 'k1', account: 'card', amount: 40905, date: '2026-08-21', transfer_id: null, tombstone: false }]],
    ]);

    const pairs = findUnlinkedTransferCandidates(byAccount);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].amountCents).toBe(40905);
    expect(pairs[0].first.id).toBe('k1');
    expect(pairs[0].second.id).toBe('c1');
  });

  test('ignores a pair whose dates are more than 3 days apart', () => {
    const byAccount = new Map([
      ['checking', [{ id: 'c1', account: 'checking', amount: -1000, date: '2026-08-24', transfer_id: null, tombstone: false }]],
      ['card', [{ id: 'k1', account: 'card', amount: 1000, date: '2026-08-19', transfer_id: null, tombstone: false }]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toEqual([]);
  });

  test('ignores already-linked transactions (transfer_id set)', () => {
    const byAccount = new Map([
      ['checking', [{ id: 'c1', account: 'checking', amount: -1000, date: '2026-08-24', transfer_id: 'k1', tombstone: false }]],
      ['card', [{ id: 'k1', account: 'card', amount: 1000, date: '2026-08-24', transfer_id: 'c1', tombstone: false }]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toEqual([]);
  });

  test('ignores tombstoned transactions', () => {
    const byAccount = new Map([
      ['checking', [{ id: 'c1', account: 'checking', amount: -1000, date: '2026-08-24', transfer_id: null, tombstone: true }]],
      ['card', [{ id: 'k1', account: 'card', amount: 1000, date: '2026-08-24', transfer_id: null, tombstone: false }]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toEqual([]);
  });

  test('skips a one-directional (non-reciprocal) match: three same-amount receipts all pointing at one sender', () => {
    // This is the real case found while fixing the live budget: three $75.00
    // contributions each see the single -$75.00 sender as their own unique
    // match, but the sender itself has three candidates -- so there is no
    // real 1:1 transfer here, and nothing should be flagged as linkable.
    const byAccount = new Map([
      ['checking', [{ id: 'sender', account: 'checking', amount: -7500, date: '2026-09-15', transfer_id: null, tombstone: false }]],
      ['kid1', [{ id: 'r1', account: 'kid1', amount: 7500, date: '2026-09-15', transfer_id: null, tombstone: false }]],
      ['kid2', [{ id: 'r2', account: 'kid2', amount: 7500, date: '2026-09-15', transfer_id: null, tombstone: false }]],
      ['kid3', [{ id: 'r3', account: 'kid3', amount: 7500, date: '2026-09-15', transfer_id: null, tombstone: false }]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toEqual([]);
  });

  test('does not flag a same-account opposite-amount pair as a transfer', () => {
    const byAccount = new Map([
      ['checking', [
        { id: 'c1', account: 'checking', amount: -1000, date: '2026-08-24', transfer_id: null, tombstone: false },
        { id: 'c2', account: 'checking', amount: 1000, date: '2026-08-24', transfer_id: null, tombstone: false },
      ]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toEqual([]);
  });

  test('does not double-report the same pair twice', () => {
    const byAccount = new Map([
      ['checking', [{ id: 'c1', account: 'checking', amount: -1000, date: '2026-08-24', transfer_id: null, tombstone: false }]],
      ['card', [{ id: 'k1', account: 'card', amount: 1000, date: '2026-08-24', transfer_id: null, tombstone: false }]],
    ]);

    expect(findUnlinkedTransferCandidates(byAccount)).toHaveLength(1);
  });
});

describe('GET /api/unlinked-transfers', () => {
  test('restricts to on-budget, open accounts and reports a flagged pair with account names', async () => {
    getActualClient.mockResolvedValue(
      stubClient({
        accounts: [
          { id: 'checking', name: 'Checking', closed: false, offbudget: false },
          { id: 'card', name: 'Chase Flex', closed: false, offbudget: false },
          { id: 'mortgage', name: 'MORTGAGE', closed: false, offbudget: true },
          { id: 'oldcard', name: 'Old Card', closed: true, offbudget: false },
        ],
        transactionsByAccount: {
          checking: [{ id: 'c1', account: 'checking', amount: -40905, date: '2026-08-24', transfer_id: null, tombstone: false }],
          card: [{ id: 'k1', account: 'card', amount: 40905, date: '2026-08-21', transfer_id: null, tombstone: false }],
        },
      })
    );

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/unlinked-transfers`, { headers: AUTH_HEADERS });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]).toEqual({
        amountCents: 40905,
        first: { id: 'k1', account: 'card', date: '2026-08-21', accountName: 'Chase Flex' },
        second: { id: 'c1', account: 'checking', date: '2026-08-24', accountName: 'Checking' },
      });
    });
  });

  test('401s with no token', async () => {
    getActualClient.mockResolvedValue(stubClient());

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/unlinked-transfers`);
      expect(res.status).toBe(401);
    });
  });
});
