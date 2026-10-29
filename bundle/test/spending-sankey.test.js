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
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const FLOW = {
  incomeCents: 100000,
  spendingCents: 80000,
  income: [
    { id: 'pay', label: 'Paychecks', amountCents: 90000 },
    { id: 'interest', label: 'Interest', amountCents: 10000 },
  ],
  groups: [
    {
      id: 'group1',
      label: 'Everyday Expenses',
      amountCents: 50000,
      categories: [
        { id: 'cat1', label: 'Groceries', amountCents: 30000 },
        { id: 'cat2', label: 'Dining', amountCents: 20000 },
      ],
    },
    { id: 'group2', label: 'Bills', amountCents: 30000, categories: [{ id: 'cat3', label: 'Electric', amountCents: 30000 }] },
  ],
};

function mockFlow(flow = FLOW) {
  fetchApi.mockImplementation((url) => {
    if (url.startsWith('/api/cash-flow')) return Promise.resolve(jsonResponse(flow));
    if (url.includes('level=payees') && url.includes('categoryId=cat1')) {
      return Promise.resolve(
        jsonResponse({
          slices: [
            { id: 'payee1', label: 'Whole Foods', amountCents: 20000 },
            { id: 'payee2', label: 'Trader Joes', amountCents: 10000 },
          ],
        }),
      );
    }
    return Promise.resolve(jsonResponse({ slices: [] }));
  });
}

function nodeLabel(target, id) {
  return target.querySelector(`[data-node-id="${id}"] text`)?.textContent.replace(/\s+/g, ' ').trim();
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  fetchApi.mockReset();
});

test('loads the whole month in a single cash-flow request', async () => {
  mockFlow();
  mountWidget();
  await flush();

  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(fetchApi.mock.calls[0][0]).toMatch(/^\/api\/cash-flow\?month=\d{4}-\d{2}$/);
});

test('renders income sources, income, savings, groups, and categories as connected nodes', async () => {
  mockFlow();
  const target = mountWidget();
  await flush();

  for (const id of ['src:pay', 'src:interest', 'income', 'savings', 'group:group1', 'group:group2', 'cat:cat1', 'cat:cat2', 'cat:cat3']) {
    expect(target.querySelector(`[data-node-id="${id}"]`)).not.toBeNull();
  }
  expect(target.querySelectorAll('.sankey-node').length).toBe(9);
  expect(target.querySelector('.sankey-link').getAttribute('d')).toBeTruthy();
});

test('saved amount is income minus spending, and labels show dollars and share of income', async () => {
  mockFlow();
  const target = mountWidget();
  await flush();

  expect(nodeLabel(target, 'savings')).toBe('Saved $200 (20%)');
  expect(nodeLabel(target, 'group:group1')).toBe('Everyday Expenses $500 (50%)');
  expect(nodeLabel(target, 'cat:cat2')).toBe('Dining $200 (20%)');
  expect(nodeLabel(target, 'src:interest')).toBe('Interest $100 (10%)');
});

test('link widths are proportional to amounts', async () => {
  mockFlow();
  const target = mountWidget();
  await flush();

  const widthTo = (label) => {
    const link = [...target.querySelectorAll('.sankey-link')].find((l) => l.querySelector('title').textContent.startsWith(`Income → ${label}:`));
    return Number(link.getAttribute('stroke-width'));
  };
  expect(widthTo('Everyday Expenses') / widthTo('Bills')).toBeCloseTo(50000 / 30000, 2);
  expect(widthTo('Bills')).toBeGreaterThan(5);
});

test('spending above income adds a "From savings" source instead of a savings node', async () => {
  mockFlow({ ...FLOW, incomeCents: 50000, income: [{ id: 'pay', label: 'Paychecks', amountCents: 50000 }] });
  const target = mountWidget();
  await flush();

  expect(target.querySelector('[data-node-id="savings"]')).toBeNull();
  expect(nodeLabel(target, 'src:shortfall')).toBe('From savings $300 (38%)');
});

test('clicking a category adds its merchants, and clicking again removes them without refetching', async () => {
  mockFlow();
  const target = mountWidget();
  await flush();

  target.querySelector('[data-node-id="cat:cat1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const payeeCalls = () => fetchApi.mock.calls.filter((call) => call[0].includes('level=payees'));
  expect(payeeCalls().length).toBe(1);
  expect(payeeCalls()[0][0]).toContain('categoryId=cat1');
  expect(target.querySelectorAll('[data-node-id^="merchant:cat1:"]').length).toBe(2);

  target.querySelector('[data-node-id="cat:cat1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  expect(payeeCalls().length).toBe(1);
  expect(target.querySelectorAll('[data-node-id^="merchant:cat1:"]').length).toBe(0);
});

test('a month with no income or spending shows a clean empty state', async () => {
  mockFlow({ incomeCents: 0, spendingCents: 0, income: [], groups: [] });
  const target = mountWidget();
  await flush();

  expect(target.querySelector('.sankey-empty').textContent).toContain('No income or spending this month yet.');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500));
  const target = mountWidget();
  await flush();

  expect(target.querySelector('.sankey-error[role="alert"]').textContent).toContain('500');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));
  const target = mountWidget();
  await flush();

  expect(target.querySelector('.sankey-error[role="alert"]')).not.toBeNull();
  expect(target.querySelector('svg')).toBeNull();
});
