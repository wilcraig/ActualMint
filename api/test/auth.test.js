// Mocks global fetch, the HTTP mechanism auth.js uses to reach actual:5006's
// /account/validate endpoint (confirmed via @actual-app/core's own client:
// see auth.js header comment for sources).
beforeEach(() => {
  jest.resetModules();
  global.fetch = jest.fn();
  process.env.ACTUAL_SERVER_URL = 'http://actual:5006';
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

test('empty/undefined token resolves false without a network call', async () => {
  const { validateToken } = require('../src/auth');

  expect(await validateToken(undefined)).toBe(false);
  expect(await validateToken('')).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a valid token is cached — a second call within the window does not re-validate', async () => {
  global.fetch.mockResolvedValue({
    text: async () => JSON.stringify({ status: 'ok', data: {} }),
  });
  const { validateToken } = require('../src/auth');

  expect(await validateToken('good-token')).toBe(true);
  expect(await validateToken('good-token')).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    'http://actual:5006/account/validate',
    expect.objectContaining({
      headers: expect.objectContaining({ 'X-ACTUAL-TOKEN': 'good-token' }),
    })
  );
});

test('cache entry expires — a call after the window re-validates', async () => {
  jest.useFakeTimers();
  global.fetch.mockResolvedValue({
    text: async () => JSON.stringify({ status: 'ok', data: {} }),
  });
  const { validateToken } = require('../src/auth');

  expect(await validateToken('good-token')).toBe(true);
  jest.advanceTimersByTime(60 * 1000 + 1);
  expect(await validateToken('good-token')).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('an invalid token resolves false and is not cached as valid', async () => {
  global.fetch.mockResolvedValue({
    text: async () => JSON.stringify({ status: 'error', reason: 'unauthorized' }),
  });
  const { validateToken } = require('../src/auth');

  expect(await validateToken('bad-token')).toBe(false);
});

test('a network failure resolves false rather than throwing', async () => {
  global.fetch.mockRejectedValue(new Error('network-failure'));
  const { validateToken } = require('../src/auth');

  await expect(validateToken('any-token')).resolves.toBe(false);
});

test('a non-JSON response resolves false rather than throwing', async () => {
  global.fetch.mockResolvedValue({ text: async () => 'not json' });
  const { validateToken } = require('../src/auth');

  await expect(validateToken('any-token')).resolves.toBe(false);
});
