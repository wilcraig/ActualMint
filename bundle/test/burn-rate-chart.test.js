vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import BurnRateChart from '../src/widgets/BurnRateChart.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Pacing "under" payload: budgeted $1,000, and actual spend through day 10
// (of a 31-day month) well below the straight-line target at that point
// (target at day 10 ≈ 1000/31*10 ≈ $322.58) -- $200 actual is under target,
// so the line/area should render green.
function underPacePayload() {
  return {
    budgetedCents: 100000,
    days: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      cumulativeSpendCents: i === 9 ? 20000 : 0,
    })),
  };
}

// Same budget/month shape, but actual spend through day 10 is well above the
// straight-line target at that point -- should render red.
function overPacePayload() {
  return {
    budgetedCents: 100000,
    days: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      cumulativeSpendCents: i === 9 ? 80000 : 0,
    })),
  };
}

function mountChart(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new BurnRateChart({ target, props });
  return target;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('fetches the current month on mount', async () => {
  fetchApi.mockResolvedValue(jsonResponse(underPacePayload()));

  mountChart();
  await flush();

  expect(fetchApi).toHaveBeenCalledTimes(1);
  const url = fetchApi.mock.calls[0][0];
  expect(url).toContain('/api/burn-rate?month=');
  // Current month, computed the same `YYYY-MM` way every other
  // current-month widget (pacing-bars, month-end-net) does.
  const now = new Date();
  const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  expect(url).toContain(`month=${expectedMonth}`);
});

test('draws a dashed linear target line from (day 1, $0) to (last day, budgetedCents)', async () => {
  fetchApi.mockResolvedValue(jsonResponse(underPacePayload()));

  const target = mountChart();
  await flush();

  const targetLine = target.querySelector('.burn-rate-target-line');
  expect(targetLine).not.toBeNull();
  expect(targetLine.getAttribute('stroke-dasharray')).toBeTruthy();

  // The target line's path should span the full chart width (day 1 to the
  // month's last day), regardless of how far the actual data runs.
  const d = targetLine.getAttribute('d');
  expect(d).toMatch(/^M\s*[-\d.]+[,\s]+[-\d.]+\s*L\s*[-\d.]+[,\s]+[-\d.]+/);
});

test('draws the actual cumulative-spend area/line, colored red when currently above the target line, green when below', async () => {
  fetchApi.mockResolvedValueOnce(jsonResponse(underPacePayload()));
  const underTarget = mountChart();
  await flush();

  const underLine = underTarget.querySelector('.burn-rate-actual-line');
  expect(underLine).not.toBeNull();
  expect(underLine.getAttribute('stroke')).toBe('#22c55e');

  fetchApi.mockResolvedValueOnce(jsonResponse(overPacePayload()));
  const overTarget = mountChart();
  await flush();

  const overLine = overTarget.querySelector('.burn-rate-actual-line');
  expect(overLine).not.toBeNull();
  expect(overLine.getAttribute('stroke')).toBe('#ef4444');
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500));

  const target = mountChart();
  await flush();

  const error = target.querySelector('[role="alert"]');
  expect(error).not.toBeNull();
  expect(error.textContent).toContain('500');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountChart();
  await flush();

  const error = target.querySelector('[role="alert"]');
  expect(error).not.toBeNull();
  expect(target.querySelector('svg')).toBeNull();
});
