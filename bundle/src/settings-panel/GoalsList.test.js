vi.mock('../api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../api-client';
import GoalsList from './GoalsList.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget() {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new GoalsList({ target });
  return target;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CATEGORIES = [
  { id: 'cat-vacation', name: 'Vacation', groupName: 'Fun', carryoverEnabled: true },
  { id: 'cat-groceries', name: 'Groceries', groupName: 'Everyday', carryoverEnabled: false },
];

const ACCOUNTS = [
  { id: 'acct-savings', name: 'Savings' },
  { id: 'acct-checking', name: 'Checking' },
];

function mockDefaultFetch({ goals = [] } = {}) {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(jsonResponse({ goals }));
    }
    if (path === '/api/categories') {
      return Promise.resolve(jsonResponse({ categories: CATEGORIES }));
    }
    if (path === '/api/accounts') {
      return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
    }
    throw new Error(`unexpected fetchApi call: ${path}`);
  });
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('lists existing goals with entity name, target amount, and target date', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  expect(target.textContent).toContain('Vacation');
  expect(target.querySelector('.goal-amount-input').value).toBe('2500.00');
  expect(target.querySelector('.goal-date-input').value).toBe('2027-06-01');
});

test('the category half of the entity picker only offers carryoverEnabled:true categories', async () => {
  mockDefaultFetch();

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  const categorySelect = target.querySelector('.goal-entity-select');
  const optionValues = Array.from(categorySelect.querySelectorAll('option')).map((o) => o.value);

  expect(optionValues).toContain('cat-vacation');
  expect(optionValues).not.toContain('cat-groceries');
});

test('adding a goal PUTs the new entry and it appears in the list', async () => {
  mockDefaultFetch();
  fetchApi.mockImplementation((path, options) => {
    if (path === '/api/goals') return Promise.resolve(jsonResponse({ goals: [] }));
    if (path === '/api/categories') return Promise.resolve(jsonResponse({ categories: CATEGORIES }));
    if (path === '/api/accounts') return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
    if (path.startsWith('/api/goals/') && options?.method === 'PUT') {
      const body = JSON.parse(options.body);
      return Promise.resolve(jsonResponse({ goal: { id: path.split('/').pop(), ...body } }));
    }
    throw new Error(`unexpected fetchApi call: ${path}`);
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  target.querySelector('.goal-new-amount-input').value = '500';
  target.querySelector('.goal-new-amount-input').dispatchEvent(new Event('input', { bubbles: true }));
  target.querySelector('.goal-new-date-input').value = '2027-01-01';
  target.querySelector('.goal-new-date-input').dispatchEvent(new Event('input', { bubbles: true }));

  target.querySelector('.goal-add-button').click();
  await flush();
  await flush();
  await flush();

  const putCall = fetchApi.mock.calls.find(([path, options]) => path.startsWith('/api/goals/') && options?.method === 'PUT');
  expect(putCall).toBeTruthy();
  const body = JSON.parse(putCall[1].body);
  expect(body.targetAmountCents).toBe(50000);
  expect(body.targetDate).toBe('2027-01-01');
  expect(body.entityType).toBe('category');
  expect(body.entityId).toBe('cat-vacation');

  expect(target.textContent).toContain('Vacation');
});

test("editing a goal's amount/date PUTs the same id with updated values", async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'account',
        entityId: 'acct-savings',
        targetAmountCents: 100000,
        targetDate: '2027-03-01',
      },
    ],
  });
  fetchApi.mockImplementation((path, options) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [
            {
              id: 'goal-1',
              entityType: 'account',
              entityId: 'acct-savings',
              targetAmountCents: 100000,
              targetDate: '2027-03-01',
            },
          ],
        })
      );
    }
    if (path === '/api/categories') return Promise.resolve(jsonResponse({ categories: CATEGORIES }));
    if (path === '/api/accounts') return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
    if (path === '/api/goals/goal-1' && options?.method === 'PUT') {
      const body = JSON.parse(options.body);
      return Promise.resolve(jsonResponse({ goal: { id: 'goal-1', ...body } }));
    }
    throw new Error(`unexpected fetchApi call: ${path}`);
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  const amountInput = target.querySelector('.goal-amount-input');
  amountInput.value = '1500.00';
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  await flush();

  const putCall = fetchApi.mock.calls.find(([path, options]) => path === '/api/goals/goal-1' && options?.method === 'PUT');
  expect(putCall).toBeTruthy();
  const body = JSON.parse(putCall[1].body);
  expect(body.targetAmountCents).toBe(150000);
  expect(body.targetDate).toBe('2027-03-01');
  expect(body.entityType).toBe('account');
  expect(body.entityId).toBe('acct-savings');
});

test('deleting a goal calls DELETE and removes it from the list', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });
  fetchApi.mockImplementation((path, options) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [
            {
              id: 'goal-1',
              entityType: 'category',
              entityId: 'cat-vacation',
              targetAmountCents: 250000,
              targetDate: '2027-06-01',
            },
          ],
        })
      );
    }
    if (path === '/api/categories') return Promise.resolve(jsonResponse({ categories: CATEGORIES }));
    if (path === '/api/accounts') return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
    if (path === '/api/goals/goal-1' && options?.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
    }
    throw new Error(`unexpected fetchApi call: ${path}`);
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  expect(target.textContent).toContain('Vacation');

  target.querySelector('.goal-delete-button').click();
  await flush();
  await flush();

  const deleteCall = fetchApi.mock.calls.find(([path, options]) => path === '/api/goals/goal-1' && options?.method === 'DELETE');
  expect(deleteCall).toBeTruthy();
  expect(target.querySelectorAll('.goal-row').length).toBe(0);
});

test('a failed PUT (non-ok response) shows an inline error next to that row, not a toast', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });
  fetchApi.mockImplementation((path, options) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [
            {
              id: 'goal-1',
              entityType: 'category',
              entityId: 'cat-vacation',
              targetAmountCents: 250000,
              targetDate: '2027-06-01',
            },
          ],
        })
      );
    }
    if (path === '/api/categories') return Promise.resolve(jsonResponse({ categories: CATEGORIES }));
    if (path === '/api/accounts') return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
    if (path === '/api/goals/goal-1' && options?.method === 'PUT') {
      return Promise.resolve(jsonResponse({ error: 'category does not have carryover enabled' }, false, 400));
    }
    throw new Error(`unexpected fetchApi call: ${path}`);
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  const amountInput = target.querySelector('.goal-amount-input');
  amountInput.value = '9999.00';
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  await flush();
  await flush();

  const row = target.querySelector('.goal-row');
  expect(row.querySelector('.goal-row-error')).toBeTruthy();
  expect(row.querySelector('.goal-row-error').textContent).toContain('category does not have carryover enabled');
  // Not a toast: the message is scoped to this row, not a page-level alert.
  expect(target.querySelectorAll('.goal-row-error').length).toBe(1);
});

test('clearing an existing goal\'s amount field shows an inline error and never PUTs targetAmountCents: 0', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  const amountInput = target.querySelector('.goal-amount-input');
  amountInput.value = '';
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  await flush();

  const putCall = fetchApi.mock.calls.find(([path, options]) => path === '/api/goals/goal-1' && options?.method === 'PUT');
  expect(putCall).toBeUndefined();

  const row = target.querySelector('.goal-row');
  expect(row.querySelector('.goal-row-error')).toBeTruthy();
  expect(row.querySelector('.goal-row-error').textContent).toContain('greater than zero');
});

test('clearing an existing goal\'s date field shows an inline error and never PUTs an empty targetDate', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  const dateInput = target.querySelector('.goal-date-input');
  dateInput.value = '';
  dateInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  await flush();

  const putCall = fetchApi.mock.calls.find(([path, options]) => path === '/api/goals/goal-1' && options?.method === 'PUT');
  expect(putCall).toBeUndefined();

  const row = target.querySelector('.goal-row');
  expect(row.querySelector('.goal-row-error')).toBeTruthy();
  expect(row.querySelector('.goal-row-error').textContent).toContain('Choose a target date');
});

test('refetches goals/categories/accounts when insights:settings-attached fires', async () => {
  mockDefaultFetch({ goals: [] });

  mountWidget();
  await flush();
  await flush();
  await flush();

  const initialCallCount = fetchApi.mock.calls.length;

  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-vacation',
        targetAmountCents: 250000,
        targetDate: '2027-06-01',
      },
    ],
  });

  document.dispatchEvent(new Event('insights:settings-attached'));
  await flush();
  await flush();
  await flush();

  expect(fetchApi.mock.calls.length).toBeGreaterThan(initialCallCount);
  expect(document.body.textContent).toContain('Vacation');
});

test('a goal referencing an unresolvable entityId shows the "(unknown category)"/"(unknown account)" fallback', async () => {
  mockDefaultFetch({
    goals: [
      {
        id: 'goal-1',
        entityType: 'category',
        entityId: 'cat-deleted',
        targetAmountCents: 100000,
        targetDate: '2027-02-01',
      },
      {
        id: 'goal-2',
        entityType: 'account',
        entityId: 'acct-deleted',
        targetAmountCents: 200000,
        targetDate: '2027-03-01',
      },
    ],
  });

  const target = mountWidget();
  await flush();
  await flush();
  await flush();

  expect(target.textContent).toContain('(unknown category)');
  expect(target.textContent).toContain('(unknown account)');
});
