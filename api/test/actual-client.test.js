jest.mock('@actual-app/api', () => ({
  init: jest.fn().mockResolvedValue(),
  downloadBudget: jest.fn().mockResolvedValue(),
  shutdown: jest.fn().mockResolvedValue(),
}));
jest.useFakeTimers();

test('reinitializes after the recycle interval elapses', async () => {
  const api = require('@actual-app/api');
  const { getActualClient } = require('../src/actual-client');

  await getActualClient();
  expect(api.init).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(60 * 60 * 1000 + 1);
  await getActualClient();

  expect(api.shutdown).toHaveBeenCalledTimes(1);
  expect(api.init).toHaveBeenCalledTimes(2);
});
