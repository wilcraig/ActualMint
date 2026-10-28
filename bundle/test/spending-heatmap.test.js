vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SpendingHeatmap from '../src/widgets/SpendingHeatmap.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function daysPayload(amounts) {
  // amounts is an array of amountCents values, one per consecutive day
  // ending today -- the exact dates don't matter to these tests, only the
  // count and values.
  const base = new Date(2026, 9, 1);
  return {
    days: amounts.map((amountCents, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const pad = (n) => String(n).padStart(2, '0');
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, amountCents };
    }),
  };
}

function mountHeatmap(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SpendingHeatmap({ target, props });
  return target;
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('defaults to range="month" (last 30 days)', async () => {
  fetchApi.mockResolvedValue(jsonResponse(daysPayload(new Array(30).fill(0))));

  mountHeatmap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchApi).toHaveBeenCalledTimes(1);
  const url = fetchApi.mock.calls[0][0];
  expect(url).toContain('/api/spending-calendar');

  const params = new URLSearchParams(url.split('?')[1]);
  const start = new Date(`${params.get('start')}T00:00:00`);
  const end = new Date(`${params.get('end')}T00:00:00`);
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  expect(diffDays).toBeGreaterThanOrEqual(28);
  expect(diffDays).toBeLessThanOrEqual(31);
});

test('range="year" requests roughly the last 366 days', async () => {
  fetchApi.mockResolvedValue(jsonResponse(daysPayload(new Array(366).fill(0))));

  mountHeatmap({ range: 'year' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const url = fetchApi.mock.calls[0][0];
  const params = new URLSearchParams(url.split('?')[1]);
  const start = new Date(`${params.get('start')}T00:00:00`);
  const end = new Date(`${params.get('end')}T00:00:00`);
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  expect(diffDays).toBeGreaterThanOrEqual(360);
  expect(diffDays).toBeLessThanOrEqual(366);
});

test('buckets days into 5 color buckets by percentile within the fetched range, not a fixed dollar scale', async () => {
  fetchApi.mockResolvedValue(jsonResponse(daysPayload([0, 0, 50, 50, 500])));

  const target = mountHeatmap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cells = Array.from(target.querySelectorAll('.heatmap-day'));
  expect(cells.length).toBe(5);

  const buckets = cells.map((c) => c.dataset.bucket);
  // The $500 day must land in a different (higher) bucket than the $0 days.
  const zeroCellBuckets = [buckets[0], buckets[1]];
  const topCellBucket = buckets[4];
  expect(zeroCellBuckets.every((b) => b !== topCellBucket)).toBe(true);
});

test('an all-zero range buckets every day as no-spend green, no quantile math needed', async () => {
  fetchApi.mockResolvedValue(jsonResponse(daysPayload([0, 0, 0, 0, 0])));

  const target = mountHeatmap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cells = Array.from(target.querySelectorAll('.heatmap-day'));
  expect(cells.length).toBe(5);
  for (const cell of cells) {
    expect(cell.dataset.bucket).toBe('0');
  }
});

test('an all-identical-but-nonzero range (every day the same amount) does not crash the quantile scale (zero variance to bucket by)', async () => {
  fetchApi.mockResolvedValue(jsonResponse(daysPayload([250, 250, 250, 250, 250])));

  let target;
  expect(() => {
    target = mountHeatmap();
  }).not.toThrow();

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const cells = Array.from(target.querySelectorAll('.heatmap-day'));
  expect(cells.length).toBe(5);
  for (const cell of cells) {
    expect(cell.dataset.bucket).not.toBe('');
    expect(cell.dataset.bucket).not.toBe('undefined');
    expect(cell.dataset.bucket).not.toBe('NaN');
    expect(Number.isNaN(Number(cell.dataset.bucket))).toBe(false);
  }
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountHeatmap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Spending heatmap unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountHeatmap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('could not reach actualmint-api');
});
