const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { readState, writeState, appendHistory, readHistory, HISTORY_LIMIT } = require('../src/forecast/state-store');

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-state-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const entry = (n, extra = {}) => ({
  at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  ok: true,
  trigger: 'schedule',
  warned: ['a1'],
  ...extra,
});

test('missing file gives empty state and history', async () => {
  expect(await readState(dir)).toEqual({});
  expect(await readHistory(dir)).toEqual([]);
});

test('writeState round-trips and a later write replaces it', async () => {
  const first = { a1: { firstDate: '2026-02-01', shortfallCents: 500, sentAt: '2026-01-31T07:00:00.000Z' } };
  await writeState(first, dir);
  expect(await readState(dir)).toEqual(first);
  await writeState({}, dir);
  expect(await readState(dir)).toEqual({});
});

test('appendHistory stores only known fields, newest first, error only when failed', async () => {
  await appendHistory({ ...entry(1), body: 'secret', error: 'ignored' }, dir);
  await appendHistory({ ...entry(2), ok: false, warned: [], error: 'boom', token: 'x' }, dir);
  expect(await readHistory(dir)).toEqual([
    { at: entry(2).at, ok: false, trigger: 'schedule', warned: [], error: 'boom' },
    { at: entry(1).at, ok: true, trigger: 'schedule', warned: ['a1'] },
  ]);
});

test('keeps only the last HISTORY_LIMIT entries', async () => {
  expect(HISTORY_LIMIT).toBe(50);
  for (let i = 0; i < 55; i += 1) await appendHistory(entry(i), dir);
  const history = await readHistory(dir);
  expect(history).toHaveLength(50);
  expect(history[0].at).toBe(entry(54).at);
});

test('concurrent writeState and appendHistory keep both', async () => {
  const state = { a1: { firstDate: '2026-02-01', shortfallCents: 1, sentAt: '2026-01-31T07:00:00.000Z' } };
  await Promise.all([writeState(state, dir), appendHistory(entry(1), dir)]);
  expect(await readState(dir)).toEqual(state);
  expect(await readHistory(dir)).toHaveLength(1);
});
