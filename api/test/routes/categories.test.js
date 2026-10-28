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
    getBudgetMonth: jest.fn(async () => ({
      categoryGroups: [
        { id: 'group1', categories: [{ id: 'catA', carryover: false }, { id: 'catB', carryover: false }] },
      ],
    })),
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categories: [{ id: 'catA', name: 'Groceries', groupName: 'Everyday Expenses', carryoverEnabled: false }],
    });
  });
});

test('each category gains carryoverEnabled from the current month\'s budget data', async () => {
  const getBudgetMonth = jest.fn(async () => ({
    categoryGroups: [
      {
        id: 'group1',
        categories: [
          { id: 'catA', carryover: true },
          { id: 'catB', carryover: false },
        ],
      },
    ],
  }));
  getActualClient.mockResolvedValue({
    getCategoryGroups: jest.fn(async () => [
      {
        id: 'group1', name: 'Everyday Expenses', hidden: false,
        categories: [
          { id: 'catA', name: 'Groceries', hidden: false, group_id: 'group1' },
          { id: 'catB', name: 'Dining', hidden: false, group_id: 'group1' },
          // Absent from the budget month entirely: must default to false, not throw.
          { id: 'catC', name: 'Brand New', hidden: false, group_id: 'group1' },
        ],
      },
    ]),
    getBudgetMonth,
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categories: [
        { id: 'catA', name: 'Groceries', groupName: 'Everyday Expenses', carryoverEnabled: true },
        { id: 'catB', name: 'Dining', groupName: 'Everyday Expenses', carryoverEnabled: false },
        { id: 'catC', name: 'Brand New', groupName: 'Everyday Expenses', carryoverEnabled: false },
      ],
    });
  });

  // Asked for the current month, computed from the server clock as YYYY-MM.
  const now = new Date();
  const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  expect(getBudgetMonth).toHaveBeenCalledWith(expectedMonth);
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
