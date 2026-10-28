vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SpendingSankey from '../src/widgets/SpendingSankey.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SpendingSankey({ target, props });
  return target;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function groupsResponse(groups) {
  return jsonResponse({ slices: groups });
}

function categoriesResponse(categories) {
  return jsonResponse({ slices: categories });
}

function payeesResponse(payees) {
  return jsonResponse({ slices: payees });
}

const TWO_GROUPS = [
  { id: 'group1', label: 'Everyday Expenses', amountCents: 50000 },
  { id: 'group2', label: 'Bills', amountCents: 30000 },
];

function mockTwoGroupsWithCategories() {
  fetchApi.mockImplementation((url) => {
    if (url.includes('level=groups')) {
      return Promise.resolve(groupsResponse(TWO_GROUPS));
    }
    if (url.includes('level=categories') && url.includes('groupId=group1')) {
      return Promise.resolve(
        categoriesResponse([
          { id: 'cat1', label: 'Groceries', amountCents: 30000 },
          { id: 'cat2', label: 'Dining', amountCents: 20000 },
        ]),
      );
    }
    if (url.includes('level=categories') && url.includes('groupId=group2')) {
      return Promise.resolve(categoriesResponse([{ id: 'cat3', label: 'Electric', amountCents: 30000 }]));
    }
    if (url.includes('level=payees') && url.includes('categoryId=cat1')) {
      return Promise.resolve(
        payeesResponse([
          { id: 'payee1', label: 'Whole Foods', amountCents: 20000 },
          { id: 'payee2', label: 'Trader Joes', amountCents: 10000 },
        ]),
      );
    }
    return Promise.resolve(jsonResponse({ slices: [] }));
  });
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('fetches groups-level breakdown on mount, then categories for every group', async () => {
  mockTwoGroupsWithCategories();

  mountWidget();
  await flush();

  const urls = fetchApi.mock.calls.map((call) => call[0]);
  expect(urls.some((u) => u.includes('level=groups'))).toBe(true);
  expect(urls.some((u) => u.includes('level=categories') && u.includes('groupId=group1'))).toBe(true);
  expect(urls.some((u) => u.includes('level=categories') && u.includes('groupId=group2'))).toBe(true);
});

test('renders a node per group and per category, with connecting links (not disconnected boxes)', async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  // 1 income node + 2 group nodes + 3 category nodes = 6
  expect(target.querySelectorAll('.sankey-node').length).toBe(6);
  expect(target.querySelectorAll('.sankey-link').length).toBeGreaterThan(0);

  // Links must be real connecting paths (a sankeyLinkHorizontal `d`), not
  // disconnected boxes with no `d` attribute.
  const link = target.querySelector('.sankey-link');
  expect(link.getAttribute('d')).toBeTruthy();
});

test('clicking a category node fetches payees for just that category and inserts a merchant column for it', async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  const categoryNode = target.querySelector('[data-node-id="cat:cat1"]');
  expect(categoryNode).not.toBeNull();
  categoryNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const urls = fetchApi.mock.calls.map((call) => call[0]);
  expect(urls.some((u) => u.includes('level=payees') && u.includes('categoryId=cat1'))).toBe(true);
  expect(urls.some((u) => u.includes('level=payees') && u.includes('categoryId=cat2'))).toBe(false);

  expect(target.querySelector('[data-node-id="merchant:cat1:payee1"]')).not.toBeNull();
  expect(target.querySelector('[data-node-id="merchant:cat1:payee2"]')).not.toBeNull();
});

test('clicking the same category node twice does not duplicate the merchant column', async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  const categoryNode = target.querySelector('[data-node-id="cat:cat1"]');
  categoryNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const payeesCallCountAfterFirst = fetchApi.mock.calls.filter((call) => call[0].includes('level=payees')).length;
  expect(payeesCallCountAfterFirst).toBe(1);
  expect(target.querySelectorAll('[data-node-id^="merchant:cat1:"]').length).toBe(2);

  // Second click collapses the column rather than re-fetching or duplicating.
  const categoryNodeAgain = target.querySelector('[data-node-id="cat:cat1"]');
  categoryNodeAgain.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const payeesCallCountAfterSecond = fetchApi.mock.calls.filter((call) => call[0].includes('level=payees')).length;
  expect(payeesCallCountAfterSecond).toBe(1);
  expect(target.querySelectorAll('[data-node-id^="merchant:cat1:"]').length).toBe(0);
});

test('a group with a single category does not crash the layout (degenerate single-child case)', async () => {
  fetchApi.mockImplementation((url) => {
    if (url.includes('level=groups')) {
      return Promise.resolve(groupsResponse([{ id: 'group1', label: 'Solo Group', amountCents: 10000 }]));
    }
    if (url.includes('level=categories')) {
      return Promise.resolve(categoriesResponse([{ id: 'cat1', label: 'Only Category', amountCents: 10000 }]));
    }
    return Promise.resolve(jsonResponse({ slices: [] }));
  });

  const target = mountWidget();
  await flush();

  expect(target.querySelector('.sankey-error')).toBeNull();
  expect(target.querySelectorAll('.sankey-node').length).toBe(3); // income + 1 group + 1 category
  expect(target.querySelector('svg')).not.toBeNull();
});

test('zero spending for the month shows a clean empty state, not a broken SVG', async () => {
  fetchApi.mockResolvedValue(groupsResponse([]));

  const target = mountWidget();
  await flush();

  const empty = target.querySelector('.sankey-empty');
  expect(empty).not.toBeNull();
  expect(empty.textContent).toContain('No spending to show.');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500));

  const target = mountWidget();
  await flush();

  const error = target.querySelector('.sankey-error[role="alert"]');
  expect(error).not.toBeNull();
  expect(error.textContent).toContain('500');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountWidget();
  await flush();

  const error = target.querySelector('.sankey-error[role="alert"]');
  expect(error).not.toBeNull();
  expect(target.querySelector('svg')).toBeNull();
});
