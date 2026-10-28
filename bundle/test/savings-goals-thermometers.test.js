vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SavingsGoalsThermometers from '../src/widgets/SavingsGoalsThermometers.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SavingsGoalsThermometers({ target, props });
  return target;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchApi.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

test('shows a clean "no goals yet" message when GET /api/goals returns an empty list', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ goals: [] }));

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('No savings goals yet');
  expect(target.textContent).toContain('Settings');
});

test('renders one thermometer per goal-tracked category, filled proportionally to current/target', async () => {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [
            { id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 120000, targetDate: '2026-12-15' },
          ],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      return Promise.resolve(
        jsonResponse({
          categories: [
            { id: 'catA', name: 'Vacation Fund', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: 47300 },
          ],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('$473.00 / $1,200.00');
  expect(target.textContent).toContain('Vacation Fund');

  const fill = target.querySelector('.goals-thermo-fill');
  expect(fill).not.toBeNull();
  const widthPct = parseFloat(fill.style.width);
  expect(widthPct).toBeCloseTo((47300 / 120000) * 100, 5);
});

test('a categoryIds prop restricts which goal-tracked categories are shown', async () => {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [
            { id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 100000, targetDate: '2026-12-01' },
            { id: 'g2', entityType: 'category', entityId: 'catB', targetAmountCents: 200000, targetDate: '2026-12-01' },
          ],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      const params = new URLSearchParams(path.split('?')[1]);
      // Confirm only the allowed category id was requested from budget-pacing too.
      expect(params.get('categories')).toBe('catA');
      return Promise.resolve(
        jsonResponse({
          categories: [{ id: 'catA', name: 'Vacation Fund', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: 10000 }],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget({ categoryIds: ['catA'] });
  await flush();

  expect(target.textContent).toContain('Vacation Fund');
  expect(target.querySelectorAll('.goals-thermo-row').length).toBe(1);
});

test('current balance exceeding target clamps fill to 100%, never overflows', async () => {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [{ id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 100000, targetDate: '2026-12-01' }],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      return Promise.resolve(
        jsonResponse({
          categories: [{ id: 'catA', name: 'Overshot Fund', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: 250000 }],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget();
  await flush();

  const fill = target.querySelector('.goals-thermo-fill');
  expect(fill.style.width).toBe('100%');
});

test('days-remaining caption derives from targetDate vs today', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 1)); // Nov 1, 2026

  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [{ id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 100000, targetDate: '2026-11-11' }],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      return Promise.resolve(
        jsonResponse({
          categories: [{ id: 'catA', name: 'Vacation Fund', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: 10000 }],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget();
  // Flush under fake timers: advance real microtasks via runAllTicks-style awaits.
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);

  expect(target.textContent).toContain('10 days left');
});

test('a goal whose category is no longer carryoverEnabled (changed after the goal was created) still renders a bounded, non-NaN bar rather than crashing', async () => {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [{ id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 50000, targetDate: '2026-12-01' }],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      // Negative balance -- e.g. the category went into the red after
      // carryover was turned off -- must still clamp to a bounded,
      // non-negative, non-NaN fill rather than crashing or overflowing.
      return Promise.resolve(
        jsonResponse({
          categories: [{ id: 'catA', name: 'Flaky Fund', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: -9900 }],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget();
  await flush();

  const fill = target.querySelector('.goals-thermo-fill');
  expect(fill).not.toBeNull();
  const widthPct = parseFloat(fill.style.width);
  expect(Number.isNaN(widthPct)).toBe(false);
  expect(widthPct).toBeGreaterThanOrEqual(0);
  expect(widthPct).toBeLessThanOrEqual(100);
});

test('a zero (or already-exceeded) target clamps fill to 100%, since the goal is trivially met', async () => {
  fetchApi.mockImplementation((path) => {
    if (path === '/api/goals') {
      return Promise.resolve(
        jsonResponse({
          goals: [{ id: 'g1', entityType: 'category', entityId: 'catA', targetAmountCents: 0, targetDate: '2026-12-01' }],
        })
      );
    }
    if (typeof path === 'string' && path.startsWith('/api/budget-pacing')) {
      return Promise.resolve(
        jsonResponse({
          categories: [{ id: 'catA', name: 'Already Funded', groupId: 'grp1', groupName: 'Savings', budgeted: 0, spent: 0, balance: 500 }],
        })
      );
    }
    return Promise.resolve(jsonResponse(null, false, 404));
  });

  const target = mountWidget();
  await flush();

  const fill = target.querySelector('.goals-thermo-fill');
  expect(fill).not.toBeNull();
  expect(fill.style.width).toBe('100%');
});

test('renders the inline error treatment on a non-ok /api/goals response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('Savings goals unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('could not reach actualmint-api');
});
