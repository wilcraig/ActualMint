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

test('flattens non-hidden category groups to { id, name }', async () => {
  getActualClient.mockResolvedValue({
    getCategoryGroups: jest.fn(async () => [
      { id: 'group1', name: 'Everyday Expenses', hidden: false, categories: [] },
      { id: 'group2', name: 'Archived Group', hidden: true, categories: [] },
    ]),
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/category-groups`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      groups: [{ id: 'group1', name: 'Everyday Expenses' }],
    });
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue({ getCategoryGroups: jest.fn(async () => []) });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/category-groups`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(validateToken).not.toHaveBeenCalled();
  });
});
