const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const {
  appendHistory,
  readHistory,
  lastSuccessAt,
  readReported,
  markReported,
  HISTORY_LIMIT,
} = require('../src/summary/history-store');

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'summary-history-test-'));
}

const entry = (i, overrides = {}) => ({
  at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  deliveryId: 'd1',
  deliveryName: 'Week in Review',
  ok: true,
  trigger: 'schedule',
  ...overrides,
});

test('empty history when the file does not exist', async () => {
  const dir = await tmpDir();
  expect(await readHistory(dir)).toEqual([]);
  expect(await lastSuccessAt('d1', dir)).toBeNull();
  expect(await readReported('d1', dir)).toEqual(new Set());
});

test('history is newest first and capped at the newest 100', async () => {
  const dir = await tmpDir();
  expect(HISTORY_LIMIT).toBe(100);
  for (let i = 0; i < 105; i++) await appendHistory(entry(i), dir);
  const history = await readHistory(dir);
  expect(history).toHaveLength(100);
  expect(history[0]).toEqual(entry(104));
  expect(history[99]).toEqual(entry(5));
});

test('only the documented fields are kept', async () => {
  const dir = await tmpDir();
  await appendHistory({ ...entry(1), body: 'message text', secret: 'x' }, dir);
  expect(Object.keys((await readHistory(dir))[0]).sort()).toEqual(['at', 'deliveryId', 'deliveryName', 'ok', 'trigger']);
});

test('error text is stored as given', async () => {
  const dir = await tmpDir();
  await appendHistory(entry(1, { ok: false, error: 'Gmail: authentication failed' }), dir);
  expect((await readHistory(dir))[0].error).toBe('Gmail: authentication failed');
});

test('lastSuccessAt ignores failures and other deliveries', async () => {
  const dir = await tmpDir();
  await appendHistory(entry(1), dir);
  await appendHistory(entry(2, { deliveryId: 'd2' }), dir);
  await appendHistory(entry(3, { ok: false, error: 'boom' }), dir);
  expect(await lastSuccessAt('d1', dir)).toEqual(new Date(entry(1).at));
  expect(await lastSuccessAt('d2', dir)).toEqual(new Date(entry(2).at));
  expect(await lastSuccessAt('d3', dir)).toBeNull();
});

test('reported ids round-trip per delivery', async () => {
  const dir = await tmpDir();
  const now = new Date(2026, 9, 29, 7);
  await markReported('d1', ['t1', 't2'], now, dir);
  await markReported('d2', ['t3'], now, dir);
  expect(await readReported('d1', dir)).toEqual(new Set(['t1', 't2']));
  expect(await readReported('d2', dir)).toEqual(new Set(['t3']));
});

test('reported ids older than 90 days are pruned on write', async () => {
  const dir = await tmpDir();
  await markReported('d1', ['old'], new Date(2026, 6, 1, 7), dir);
  await markReported('d1', ['mid'], new Date(2026, 8, 1, 7), dir);
  // 2026-07-01 is 120 days before 2026-10-29; 2026-09-01 is 58 days before.
  await markReported('d1', ['new'], new Date(2026, 9, 29, 7), dir);
  expect(await readReported('d1', dir)).toEqual(new Set(['mid', 'new']));
});

test('marking reported keeps history intact and vice versa', async () => {
  const dir = await tmpDir();
  await appendHistory(entry(1), dir);
  await markReported('d1', ['t1'], new Date(2026, 9, 29), dir);
  await appendHistory(entry(2), dir);
  expect(await readHistory(dir)).toHaveLength(2);
  expect(await readReported('d1', dir)).toEqual(new Set(['t1']));
});

test('concurrent appends are all kept', async () => {
  const dir = await tmpDir();
  await Promise.all([0, 1, 2, 3, 4, 5].map((i) => appendHistory(entry(i), dir)));
  expect(await readHistory(dir)).toHaveLength(6);
});
