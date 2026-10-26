vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import CategoryBreakdownModal from '../src/widgets/CategoryBreakdownModal.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountModal(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  return new CategoryBreakdownModal({
    target,
    props: {
      categoryId: 'catA',
      categoryName: 'Groceries',
      groupId: 'group1',
      groupName: 'Everyday Expenses',
      onClose: () => {},
      ...props,
    },
  });
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('fetches the payees-level breakdown for the opened category on mount', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 500, slices: [{ id: 'p1', label: 'Trader Joes', amountCents: 500 }] }));

  mountModal();
  await Promise.resolve();
  await Promise.resolve();

  expect(fetchApi).toHaveBeenCalledTimes(1);
  const url = fetchApi.mock.calls[0][0];
  expect(url).toContain('level=payees');
  expect(url).toContain('categoryId=catA');
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = document.createElement('div');
  target.id = 'host';
  document.body.innerHTML = '';
  document.body.appendChild(target);
  new CategoryBreakdownModal({
    target,
    props: { categoryId: 'catA', categoryName: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses' },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.textContent).toContain('Spending breakdown unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownModal({
    target,
    props: { categoryId: 'catA', categoryName: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses' },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.textContent).toContain('could not reach actualmint-api');
});

test('zooming out via breadcrumb re-fetches at the categories level for the known group', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  mountModal();
  await Promise.resolve();
  await Promise.resolve();

  const target = document.getElementById('host');
  const groupBreadcrumb = Array.from(target.querySelectorAll('button.breadcrumb-item')).find((b) =>
    b.textContent.includes('Everyday Expenses'),
  );
  groupBreadcrumb.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  await Promise.resolve();
  await Promise.resolve();

  const lastUrl = fetchApi.mock.calls[fetchApi.mock.calls.length - 1][0];
  expect(lastUrl).toContain('level=categories');
  expect(lastUrl).toContain('groupId=group1');
});

test('a slower in-flight request that resolves after a newer one does not clobber the newer state', async () => {
  // Simulate rapid navigation: the first load() (groups->categories zoom
  // out, triggered on mount at 'payees') is slow; before it resolves, a
  // second, faster navigation (breadcrumb click back to 'categories')
  // fires and resolves first. The slow first response must be discarded
  // when it finally arrives, not overwrite the newer, correct state.
  let resolveFirst;
  const firstPromise = new Promise((resolve) => {
    resolveFirst = resolve;
  });

  fetchApi
    .mockImplementationOnce(() => firstPromise)
    .mockResolvedValueOnce(
      jsonResponse({ total: 900, slices: [{ id: 'p2', label: 'Second (newer)', amountCents: 900 }] }),
    );

  mountModal();
  // Let the mount-triggered load() call fetchApi and register as call #1,
  // without resolving it yet.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const target = document.getElementById('host');
  const groupBreadcrumb = Array.from(target.querySelectorAll('button.breadcrumb-item')).find((b) =>
    b.textContent.includes('Everyday Expenses'),
  );
  groupBreadcrumb.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // Let the second (faster) load() resolve fully first.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Second (newer)');

  // Now let the first (slower) request's response arrive late.
  resolveFirst(jsonResponse({ total: 500, slices: [{ id: 'p1', label: 'First (stale)', amountCents: 500 }] }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The stale response must not have overwritten the newer state.
  expect(target.textContent).toContain('Second (newer)');
  expect(target.textContent).not.toContain('First (stale)');
});

test('calls onClose when the close control is clicked', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  let closed = false;
  mountModal({ onClose: () => { closed = true; } });
  await Promise.resolve();
  await Promise.resolve();

  const target = document.getElementById('host');
  target.querySelector('button.breakdown-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));

  expect(closed).toBe(true);
});
