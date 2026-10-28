vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import AccountBalancesChart from '../src/widgets/AccountBalancesChart.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function multiDayPayload() {
  return {
    range: '1M',
    rangeStart: '2026-09-26',
    rangeEnd: '2026-10-26',
    accounts: [
      {
        id: 'acc1',
        name: 'Checking',
        points: [
          { date: '2026-10-24', balanceCents: 10000 },
          { date: '2026-10-25', balanceCents: 10500 },
          { date: '2026-10-26', balanceCents: 11000 },
        ],
      },
      {
        id: 'acc2',
        name: 'Savings',
        points: [
          { date: '2026-10-24', balanceCents: 50000 },
          { date: '2026-10-25', balanceCents: 50000 },
          { date: '2026-10-26', balanceCents: 50500 },
        ],
      },
    ],
    netWorth: [
      { date: '2026-10-24', balanceCents: 60000 },
      { date: '2026-10-25', balanceCents: 60500 },
      { date: '2026-10-26', balanceCents: 61500 },
    ],
  };
}

function mountChart(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new AccountBalancesChart({ target, props });
  return target;
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('fetches the default 1M range on mount', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(fetchApi.mock.calls[0][0]).toContain('range=1M');
});

test('with no accountIds prop, fetches without an accounts filter (every open account)', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi.mock.calls[0][0]).not.toContain('accounts=');
});

test('with an accountIds prop, fetches with a comma-joined accounts filter', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  mountChart({ accountIds: ['acc1', 'acc2'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const url = fetchApi.mock.calls[0][0];
  expect(url).toContain('range=1M');
  expect(decodeURIComponent(url)).toContain('accounts=acc1,acc2');
});

function switchToCombinedView(target) {
  const combinedButton = Array.from(target.querySelectorAll('button.balances-range-button')).find(
    (b) => b.textContent.trim() === 'Combined',
  );
  combinedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function switchToSeparateView(target) {
  const separateButton = Array.from(target.querySelectorAll('button.balances-range-button')).find(
    (b) => b.textContent.trim() === 'Separate',
  );
  separateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

test('separate view (selectable, no longer the default): one mini area chart per account, each with its own large current-balance figure', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  switchToSeparateView(target);
  await new Promise((resolve) => setTimeout(resolve, 0));

  // 2 accounts + 1 Total card.
  expect(target.querySelectorAll('.balances-mini-card').length).toBe(3);
  expect(target.querySelectorAll('.balances-mini-area').length).toBe(3);

  const values = Array.from(target.querySelectorAll('.balances-mini-value')).map((el) => el.textContent.trim());
  expect(values).toContain('$110.00'); // Checking's latest balance, 11000 cents
  expect(values).toContain('$505.00'); // Savings' latest balance, 50500 cents
  expect(values).toContain('$615.00'); // Total/net worth's latest balance, 61500 cents

  // No combined-view elements rendered at the same time.
  expect(target.querySelector('path.balances-area')).toBeNull();
});

test('combined view (the default): a stacked area band per account, each labeled with its own (not cumulative) balance, plus a total below the chart', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const areas = target.querySelectorAll('path.balances-area');
  expect(areas.length).toBe(2);

  const names = Array.from(target.querySelectorAll('.balances-area-name')).map((el) => el.textContent.trim());
  expect(names).toEqual(['Checking', 'Savings']);

  const labels = Array.from(target.querySelectorAll('.balances-area-label')).map((el) => el.textContent.trim());
  // Each account's OWN latest balance, never the running cumulative total
  // the stack's top edge would otherwise suggest (Checking's own $110.00,
  // not Savings' $615.00 cumulative-through-Savings figure).
  expect(labels).toEqual(['$110.00', '$505.00']);

  // The combined total (same figure as the Separate view's Total card)
  // appears once, below the chart -- not as a band label.
  expect(target.querySelector('.balances-combined-total').textContent.trim()).toBe('Total: $615.00');

  // No separate legend -- the in-band name + balance labels are the only
  // way account identity is shown in this view now.
  expect(target.querySelector('.balances-legend')).toBeNull();
});

test('clicking a range button re-fetches with the new range', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sixMonthButton = Array.from(target.querySelectorAll('button.balances-range-button')).find(
    (b) => b.textContent.trim() === '6M',
  );
  sixMonthButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi).toHaveBeenCalledTimes(2);
  expect(fetchApi.mock.calls[1][0]).toContain('range=6M');
  expect(sixMonthButton.classList.contains('balances-range-button--active')).toBe(true);
});

test('shows an empty-state message with no broken SVG when there are no accounts', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({ range: '1M', rangeStart: '2026-09-26', rangeEnd: '2026-10-26', accounts: [], netWorth: [] }),
  );

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Not enough balance history yet to chart.');
  expect(target.querySelector('svg')).toBeNull();
});

test('shows an empty-state message for the brand-new-budget single-day series edge case', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({
      range: '1M',
      rangeStart: '2026-10-26',
      rangeEnd: '2026-10-26',
      accounts: [{ id: 'acc1', name: 'Checking', points: [{ date: '2026-10-26', balanceCents: 0 }] }],
      netWorth: [{ date: '2026-10-26', balanceCents: 0 }],
    }),
  );

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Not enough balance history yet to chart.');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Account balances unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('could not reach actualmint-api');
});

test('a slower in-flight request that resolves after a newer one does not clobber the newer range', async () => {
  let resolveFirst;
  const firstPromise = new Promise((resolve) => {
    resolveFirst = resolve;
  });

  fetchApi.mockImplementationOnce(() => firstPromise).mockResolvedValueOnce(jsonResponse(multiDayPayload()));

  const target = mountChart();
  // Let the mount-triggered load() call fetchApi and register as call #1,
  // without resolving it yet.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sixMonthButton = Array.from(target.querySelectorAll('button.balances-range-button')).find(
    (b) => b.textContent.trim() === '6M',
  );
  sixMonthButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 0));

  // 2 accounts, in the default combined (stacked-area) view.
  expect(target.querySelectorAll('path.balances-area').length).toBe(2);

  resolveFirst(
    jsonResponse({
      range: '1M',
      rangeStart: '2026-10-26',
      rangeEnd: '2026-10-26',
      accounts: [{ id: 'stale', name: 'Stale', points: [{ date: '2026-10-26', balanceCents: 0 }] }],
      netWorth: [{ date: '2026-10-26', balanceCents: 0 }],
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The stale (single-day) response must not have overwritten the newer,
  // fully-populated chart with an empty-state render.
  expect(target.querySelectorAll('path.balances-area').length).toBe(2);
  expect(target.textContent).not.toContain('Not enough balance history yet to chart.');
});
