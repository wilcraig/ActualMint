jest.mock('@actual-app/api', () => ({
  init: jest.fn().mockResolvedValue(),
  downloadBudget: jest.fn().mockResolvedValue(),
  loadBudget: jest.fn().mockResolvedValue(),
  getBudgets: jest.fn().mockResolvedValue([]),
  shutdown: jest.fn().mockResolvedValue(),
  sync: jest.fn().mockResolvedValue(),
}));
jest.useFakeTimers();

// Mock call counts are cumulative across tests in this file (the
// actual-client module, and its single initialized client, is intentionally
// shared); clear just the call history between tests so each test's
// assertions are about calls made within that test.
beforeEach(() => {
  jest.clearAllMocks();
});

test('sync is called on first use, throttled within the window, and refreshed after it elapses', async () => {
  const api = require('@actual-app/api');
  const { getActualClient, syncIfDue, SYNC_THROTTLE_MS } = require('../src/actual-client');

  const client = await getActualClient();

  // getActualClient()'s own init already did an initial sync (via
  // downloadBudget); move past that throttle window so the first syncIfDue
  // call below is actually due.
  jest.advanceTimersByTime(SYNC_THROTTLE_MS + 1);

  // (a) a sync-due call triggers client.sync().
  await syncIfDue(client);
  expect(api.sync).toHaveBeenCalledTimes(1);

  // (b) a second call within the throttle window does not trigger another.
  await syncIfDue(client);
  await syncIfDue(client);
  expect(api.sync).toHaveBeenCalledTimes(1);

  // (c) once the throttle window has elapsed, the next call syncs again.
  jest.advanceTimersByTime(SYNC_THROTTLE_MS + 1);
  await syncIfDue(client);
  expect(api.sync).toHaveBeenCalledTimes(2);
});

test('concurrent requests during an in-flight sync share one promise, not one each', async () => {
  const api = require('@actual-app/api');
  const { getActualClient, syncIfDue } = require('../src/actual-client');

  let resolveSync;
  api.sync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSync = resolve;
      })
  );

  const client = await getActualClient();
  const { SYNC_THROTTLE_MS } = require('../src/actual-client');
  jest.advanceTimersByTime(SYNC_THROTTLE_MS + 1);

  const first = syncIfDue(client);
  const second = syncIfDue(client);
  const third = syncIfDue(client);

  expect(api.sync).toHaveBeenCalledTimes(1);

  resolveSync();
  await Promise.all([first, second, third]);

  expect(api.sync).toHaveBeenCalledTimes(1);
});
