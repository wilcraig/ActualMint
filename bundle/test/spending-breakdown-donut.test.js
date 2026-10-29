vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SpendingBreakdownDonut from '../src/widgets/SpendingBreakdownDonut.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SpendingBreakdownDonut({ target, props });
  return target;
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('with date and hideTransfers, fetches that single day and drops a "Transfers" group', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({
      total: 10500,
      slices: [
        { id: 'g1', label: 'Food', amountCents: 500 },
        { id: 'gx', label: 'Transfers', amountCents: 10000 },
      ],
    }),
  );

  const target = mountWidget({ date: '2026-10-15', hideTransfers: true });
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));

  const params = new URLSearchParams(fetchApi.mock.calls[0][0].split('?')[1]);
  expect(params.get('date')).toBe('2026-10-15');
  expect(params.has('month')).toBe(false);
  const slices = [...target.querySelectorAll('.donut-slice')].map((s) => s.getAttribute('aria-label'));
  expect(slices).toHaveLength(1);
  expect(slices[0]).toContain('Food');
});

test('fetches the groups-level breakdown on mount, with no groupIds filter by default', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 500, slices: [{ id: 'g1', label: 'Everyday Expenses', amountCents: 500 }] }));

  mountWidget();
  await Promise.resolve();
  await Promise.resolve();

  expect(fetchApi).toHaveBeenCalledTimes(1);
  const url = fetchApi.mock.calls[0][0];
  expect(url).toContain('level=groups');
  expect(url).not.toContain('groupIds=');
});

test('with a groupIds prop, fetches with a comma-joined groupIds filter', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  mountWidget({ groupIds: ['group1', 'group2'] });
  await Promise.resolve();
  await Promise.resolve();

  const url = fetchApi.mock.calls[0][0];
  expect(decodeURIComponent(url)).toContain('groupIds=group1,group2');
});

test('renders the donut for the groups-level breakdown and drills in on a slice click', async () => {
  fetchApi
    .mockResolvedValueOnce(jsonResponse({ total: 500, slices: [{ id: 'group1', label: 'Everyday Expenses', amountCents: 500 }] }))
    .mockResolvedValueOnce(
      jsonResponse({ total: 500, slices: [{ id: 'catA', label: 'Groceries', amountCents: 500 }] }),
    );

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.querySelectorAll('path.donut-slice').length).toBe(1);

  target.querySelector('path.donut-slice').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi.mock.calls[1][0]).toContain('level=categories');
  expect(fetchApi.mock.calls[1][0]).toContain('groupId=group1');
  expect(target.textContent).toContain('Everyday Expenses');
});

test('no Back button at the entry (groups) level', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  const target = mountWidget();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.querySelector('button.breakdown-back')).toBeNull();
});

test('drilling into a group, then clicking Back, re-fetches the groups level', async () => {
  fetchApi
    .mockResolvedValueOnce(jsonResponse({ total: 500, slices: [{ id: 'group1', label: 'Everyday Expenses', amountCents: 500 }] }))
    .mockResolvedValueOnce(jsonResponse({ total: 500, slices: [{ id: 'catA', label: 'Groceries', amountCents: 500 }] }))
    .mockResolvedValueOnce(jsonResponse({ total: 500, slices: [{ id: 'group1', label: 'Everyday Expenses', amountCents: 500 }] }));

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));

  target.querySelector('path.donut-slice').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.querySelector('button.breakdown-back')).not.toBeNull();

  target.querySelector('button.breakdown-back').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi.mock.calls[2][0]).toContain('level=groups');
  expect(target.querySelector('button.breakdown-back')).toBeNull();
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountWidget();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.textContent).toContain('Spending breakdown unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountWidget();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.textContent).toContain('could not reach actualmint-api');
});
