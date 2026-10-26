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

test('flattens non-hidden categories from non-hidden groups with their group name', async () => {
  getActualClient.mockResolvedValue({
    getCategoryGroups: jest.fn(async () => [
      {
        id: 'group1', name: 'Everyday Expenses', hidden: false,
        categories: [
          { id: 'catA', name: 'Groceries', hidden: false, group_id: 'group1' },
          { id: 'catB', name: 'Old Category', hidden: true, group_id: 'group1' },
        ],
      },
      {
        id: 'group2', name: 'Archived Group', hidden: true,
        categories: [{ id: 'catC', name: 'Gone', hidden: false, group_id: 'group2' }],
      },
    ]),
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categories: [{ id: 'catA', name: 'Groceries', groupName: 'Everyday Expenses' }],
    });
  });
});

test('401s with no token', async () => {
  getActualClient.mockResolvedValue({ getCategoryGroups: jest.fn(async () => []) });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(validateToken).not.toHaveBeenCalled();
  });
});
