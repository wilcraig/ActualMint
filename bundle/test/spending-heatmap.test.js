vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SpendingHeatmap from '../src/widgets/SpendingHeatmap.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Echoes back one entry per requested day, with amounts from `amountFor(dayOfMonth, dateStr)`.
function mockCalendar(amountFor = () => 0) {
  fetchApi.mockImplementation((url) => {
    if (!url.startsWith('/api/spending-calendar')) return Promise.resolve(jsonResponse({ total: 0, slices: [] }));
    const params = new URLSearchParams(url.split('?')[1]);
    const days = [];
    for (let d = new Date(`${params.get('start')}T00:00:00`); iso(d) <= params.get('end'); d.setDate(d.getDate() + 1)) {
      days.push({ date: iso(d), amountCents: amountFor(d.getDate(), iso(d)) });
    }
    return Promise.resolve(jsonResponse({ days }));
  });
}

function mountHeatmap(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SpendingHeatmap({ target, props });
  return target;
}

async function flush() {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

beforeEach(() => {
  fetchApi.mockReset();
});

test('month view requests the current month from the 1st through today and lays it out as a calendar', async () => {
  mockCalendar();
  const target = mountHeatmap();
  await flush();

  const params = new URLSearchParams(fetchApi.mock.calls[0][0].split('?')[1]);
  expect(params.get('start')).toBe(iso(firstOfMonth));
  expect(params.get('end')).toBe(iso(today));

  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  expect(target.querySelectorAll('[data-date]').length).toBe(daysInMonth);
  expect(target.querySelectorAll('.heatmap-weekday').length).toBe(7);
  // Leading blanks line the 1st up under its real weekday.
  expect(target.querySelectorAll('.heatmap-blank').length).toBe(firstOfMonth.getDay());
  expect(target.querySelector(`[data-date="${iso(firstOfMonth)}"] .heatmap-day-number`).textContent).toBe('1');
});

test('spend days show their amount and a legend explains the colors in dollars', async () => {
  mockCalendar((day) => (day === 1 ? 4200 : 0));
  const target = mountHeatmap();
  await flush();

  const first = target.querySelector(`[data-date="${iso(firstOfMonth)}"]`);
  expect(first.querySelector('.heatmap-day-amount').textContent).toBe('$42');
  expect(target.querySelector('.heatmap-legend').textContent).toContain('No spending');
  expect(target.querySelector('.heatmap-total').textContent).toContain('$42');
});

test('the previous-month arrow loads last month, and next is disabled on the current month', async () => {
  mockCalendar();
  const target = mountHeatmap();
  await flush();

  expect(target.querySelector('[aria-label="Next month"]').disabled).toBe(true);
  target.querySelector('[aria-label="Previous month"]').click();
  await flush();

  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
  const params = new URLSearchParams(fetchApi.mock.calls.at(-1)[0].split('?')[1]);
  expect(params.get('start')).toBe(iso(lastMonth));
  expect(params.get('end')).toBe(iso(lastDay));
  expect(target.querySelector('[aria-label="Next month"]').disabled).toBe(false);
});

test('clicking a spend day opens a donut breakdown for just that date', async () => {
  mockCalendar((day) => (day === 1 ? 4200 : 0));
  const target = mountHeatmap();
  await flush();

  target.querySelector(`button[data-date="${iso(firstOfMonth)}"]`).click();
  await flush();

  const modal = document.querySelector('.actualmint-day-modal');
  expect(modal).not.toBeNull();
  expect(modal.textContent).toContain('$42');
  const breakdownUrl = fetchApi.mock.calls.map((c) => c[0]).find((u) => u.startsWith('/api/spending-breakdown'));
  const params = new URLSearchParams(breakdownUrl.split('?')[1]);
  expect(params.get('date')).toBe(iso(firstOfMonth));
  expect(params.get('level')).toBe('groups');
  expect(params.has('month')).toBe(false);

  modal.querySelector('[aria-label="Close"]').click();
  await flush();
  expect(document.querySelector('.actualmint-day-modal')).toBeNull();
});

test('zero-spend days are not clickable', async () => {
  mockCalendar();
  const target = mountHeatmap();
  await flush();
  expect(target.querySelector('button[data-date]')).toBeNull();
});

test('range="year" shows 12 small month calendars', async () => {
  mockCalendar();
  const target = mountHeatmap({ range: 'year' });
  await flush();

  expect(target.querySelectorAll('.heatmap-calendar').length).toBe(12);
  const params = new URLSearchParams(fetchApi.mock.calls[0][0].split('?')[1]);
  expect(params.get('start')).toBe(iso(new Date(today.getFullYear(), today.getMonth() - 11, 1)));
});

test('an all-identical nonzero month does not crash the quantile scale', async () => {
  mockCalendar(() => 5000);
  const target = mountHeatmap();
  await flush();
  expect(target.querySelector('.heatmap-error')).toBeNull();
  expect(target.querySelectorAll('button[data-date]').length).toBeGreaterThan(0);
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500));
  const target = mountHeatmap();
  await flush();
  expect(target.querySelector('.heatmap-error[role="alert"]').textContent).toContain('500');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));
  const target = mountHeatmap();
  await flush();
  expect(target.querySelector('.heatmap-error[role="alert"]')).not.toBeNull();
});
