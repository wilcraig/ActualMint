const mockCalls = [];
let mockShutdownResolve = null;

jest.mock('@actual-app/api', () => ({
  init: jest.fn(async () => {
    mockCalls.push('init');
  }),
  downloadBudget: jest.fn().mockResolvedValue(),
  shutdown: jest.fn(
    () =>
      new Promise((resolve) => {
        mockShutdownResolve = () => {
          mockCalls.push('shutdown-settled');
          resolve();
        };
      })
  ),
}));
jest.useFakeTimers();

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test('does not re-init while the previous shutdown is still in flight', async () => {
  const api = require('@actual-app/api');
  const { getActualClient, RECYCLE_MS } = require('../src/actual-client');

  await getActualClient();
  expect(api.init).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(RECYCLE_MS);
  expect(api.shutdown).toHaveBeenCalledTimes(1);

  // A caller arriving mid-recycle must wait for shutdown to settle.
  const concurrent = getActualClient();
  await flushMicrotasks();
  expect(api.init).toHaveBeenCalledTimes(1);

  mockShutdownResolve();
  await concurrent;

  expect(api.init).toHaveBeenCalledTimes(2);
  expect(mockCalls).toEqual(['init', 'shutdown-settled', 'init']);
});
