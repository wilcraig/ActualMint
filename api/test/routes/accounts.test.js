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

beforeEach(() => {
  getActualClient.mockReset();
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
});

test('excludes closed accounts', async () => {
  getActualClient.mockResolvedValue({
    getAccounts: jest.fn(async () => [
      { id: 'acc1', name: 'Checking', closed: false },
      { id: 'acc2', name: 'Old Savings', closed: true },
    ]),
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/accounts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [{ id: 'acc1', name: 'Checking' }] });
  });
});

test('keeps accounts that have no closed flag set', async () => {
  getActualClient.mockResolvedValue({
    getAccounts: jest.fn(async () => [
      { id: 'acc1', name: 'Checking' },
      { id: 'acc2', name: 'Closed Card', closed: true },
    ]),
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/accounts`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [{ id: 'acc1', name: 'Checking' }] });
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue({ getAccounts: jest.fn(async () => []) });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/accounts`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(validateToken).not.toHaveBeenCalled();
  });
});
