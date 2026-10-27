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

function mountChart() {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new AccountBalancesChart({ target });
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

test('renders one line per account plus a visually distinct net-worth line', async () => {
  fetchApi.mockResolvedValue(jsonResponse(multiDayPayload()));

  const target = mountChart();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lines = target.querySelectorAll('path.balances-line');
  // 2 accounts + 1 net-worth line.
  expect(lines.length).toBe(3);

  const netWorthLine = target.querySelector('path.balances-line--net-worth');
  expect(netWorthLine).not.toBeNull();
  // Never shares a stroke color with a per-account line.
  const accountColors = new Set(
    Array.from(target.querySelectorAll('path.balances-line:not(.balances-line--net-worth)')).map((el) =>
      el.getAttribute('stroke'),
    ),
  );
  expect(accountColors.has(netWorthLine.getAttribute('stroke'))).toBe(false);

  expect(target.querySelectorAll('.balances-legend-item').length).toBe(3);
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

  expect(target.querySelectorAll('path.balances-line').length).toBe(3);

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
  expect(target.querySelectorAll('path.balances-line').length).toBe(3);
  expect(target.textContent).not.toContain('Not enough balance history yet to chart.');
});
