// Separate test file (its own module/mock instance), same pattern as
// actual-client-sync-throttle.test.js and actual-client-recycle-race.test.js
// each being split out from actual-client.test.js -- this file is entirely
// about which of downloadBudget() vs loadBudget()+sync() openClient() picks.
jest.mock('@actual-app/api', () => ({
  init: jest.fn().mockResolvedValue(),
  downloadBudget: jest.fn().mockResolvedValue(),
  loadBudget: jest.fn().mockResolvedValue(),
  sync: jest.fn().mockResolvedValue(),
  getBudgets: jest.fn().mockResolvedValue([]),
  shutdown: jest.fn().mockResolvedValue(),
}));
jest.useFakeTimers();

// Despite the env var's name, this deployment's ACTUAL_SYNC_ID is the sync
// *group* id (confirmed against production: it matches getBudgets()'s
// groupId field, not cloudFileId -- see the comment in actual-client.js).
const ACTUAL_SYNC_ID = 'group-id-123';
const ORIGINAL_SYNC_ID = process.env.ACTUAL_SYNC_ID;

// actual-client.js keeps its connection state (clientPromise, everConnected,
// the recycle timer) in module-level singletons, so a test that reused the
// same module instance as an earlier test would silently reuse that
// earlier test's already-open "connection" instead of exercising
// openClient() at all. jest.resetModules() plus a fresh require() per test
// gives each test its own clean singleton.
beforeEach(() => {
  process.env.ACTUAL_SYNC_ID = ACTUAL_SYNC_ID;
  jest.resetModules();
});

afterEach(() => {
  process.env.ACTUAL_SYNC_ID = ORIGINAL_SYNC_ID;
});

test('with no local cache for this cloud file, uses downloadBudget (first-ever connection)', async () => {
  const api = require('@actual-app/api');
  api.getBudgets.mockResolvedValue([]);
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();

  expect(api.downloadBudget).toHaveBeenCalledWith(ACTUAL_SYNC_ID, expect.anything());
  expect(api.loadBudget).not.toHaveBeenCalled();
});

test('with a cached local budget for this sync group, uses loadBudget + sync instead of downloadBudget', async () => {
  const api = require('@actual-app/api');
  api.getBudgets.mockResolvedValue([
    { id: 'My-Finances-347871b', groupId: ACTUAL_SYNC_ID },
  ]);
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();

  expect(api.loadBudget).toHaveBeenCalledWith('My-Finances-347871b');
  expect(api.sync).toHaveBeenCalledTimes(1);
  expect(api.downloadBudget).not.toHaveBeenCalled();
});

test('getBudgets\' real production shape -- a local entry plus a remote-only entry with no id -- is handled correctly', async () => {
  // Confirmed against the live server: getBudgets() returns one entry per
  // locally-downloaded budget (has `id`) AND one per budget that only
  // exists on the server so far (no `id`, `state: "remote"`), even for the
  // SAME budget once it's been downloaded once. The remote-only entry must
  // never be mistaken for a usable local cache.
  const api = require('@actual-app/api');
  api.getBudgets.mockResolvedValue([
    { id: 'My-Finances-347871b', cloudFileId: 'cloud-file-abc', groupId: ACTUAL_SYNC_ID, name: 'Mint' },
    { cloudFileId: 'cloud-file-abc', state: 'remote', groupId: ACTUAL_SYNC_ID, name: 'Mint' },
  ]);
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();

  expect(api.loadBudget).toHaveBeenCalledWith('My-Finances-347871b');
  expect(api.downloadBudget).not.toHaveBeenCalled();
});

test('a cached budget for a DIFFERENT sync group is ignored -- still downloads this one', async () => {
  const api = require('@actual-app/api');
  api.getBudgets.mockResolvedValue([{ id: 'some-other-budget', groupId: 'a-different-group' }]);
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();

  expect(api.downloadBudget).toHaveBeenCalledWith(ACTUAL_SYNC_ID, expect.anything());
  expect(api.loadBudget).not.toHaveBeenCalled();
});

test('a remote-only entry (no id) for the right group, with no local entry, still downloads', async () => {
  const api = require('@actual-app/api');
  api.getBudgets.mockResolvedValue([{ cloudFileId: 'cloud-file-abc', state: 'remote', groupId: ACTUAL_SYNC_ID, name: 'Mint' }]);
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();

  expect(api.downloadBudget).toHaveBeenCalledWith(ACTUAL_SYNC_ID, expect.anything());
  expect(api.loadBudget).not.toHaveBeenCalled();
});

test('a getBudgets failure falls back to downloadBudget rather than throwing', async () => {
  const api = require('@actual-app/api');
  api.getBudgets.mockRejectedValue(new Error('disk read failed'));
  const { getActualClient } = require('../src/actual-client');

  await expect(getActualClient()).resolves.toBe(api);
  expect(api.downloadBudget).toHaveBeenCalledWith(ACTUAL_SYNC_ID, expect.anything());
});

test('a recycle (hourly) reuses the now-local cache via loadBudget, not another downloadBudget', async () => {
  const api = require('@actual-app/api');
  // First connection: no cache yet.
  api.getBudgets.mockResolvedValueOnce([]);
  const { getActualClient, RECYCLE_MS } = require('../src/actual-client');

  await getActualClient();
  expect(api.downloadBudget).toHaveBeenCalledTimes(1);

  // By the time of the recycle, this container has its own local cache now.
  api.getBudgets.mockResolvedValue([{ id: 'My-Finances-347871b', groupId: ACTUAL_SYNC_ID }]);

  jest.advanceTimersByTime(RECYCLE_MS + 1);
  await getActualClient();

  expect(api.downloadBudget).toHaveBeenCalledTimes(1); // still just the first one
  expect(api.loadBudget).toHaveBeenCalledWith('My-Finances-347871b');
});
