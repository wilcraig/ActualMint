vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import SpendingTreemap from '../src/widgets/SpendingTreemap.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget(props = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new SpendingTreemap({ target, props });
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
    return Promise.resolve(jsonResponse({ slices: [] }));
  });
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('fetches groups-level breakdown on mount', async () => {
  mockTwoGroupsWithCategories();

  mountWidget();
  await flush();

  const urls = fetchApi.mock.calls.map((call) => call[0]);
  expect(urls.some((u) => u.includes('level=groups'))).toBe(true);
});

test('renders one rectangle per group, sized proportionally to amountCents', async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  const rects = target.querySelectorAll('.treemap-cell-rect');
  expect(rects.length).toBe(2);

  const group1Rect = target.querySelector('[data-cell-id="group1"] rect');
  const group2Rect = target.querySelector('[data-cell-id="group2"] rect');
  expect(group1Rect).not.toBeNull();
  expect(group2Rect).not.toBeNull();

  // group1 has more spending (50000 vs 30000), so its area should be larger.
  const area1 = Number(group1Rect.getAttribute('width')) * Number(group1Rect.getAttribute('height'));
  const area2 = Number(group2Rect.getAttribute('width')) * Number(group2Rect.getAttribute('height'));
  expect(area1).toBeGreaterThan(area2);
});

test('leaves out a "Transfers" group, since it moves money between accounts rather than spending it', async () => {
  fetchApi.mockImplementation((url) =>
    Promise.resolve(
      groupsResponse([
        { id: 'group1', label: 'Home', amountCents: 50000 },
        { id: 'xfer', label: 'Transfers', amountCents: 900000 },
      ]),
    ),
  );

  const target = mountWidget();
  await flush();

  expect(target.querySelector('[data-cell-id="xfer"]')).toBeNull();
  expect(target.querySelectorAll('.treemap-cell-rect').length).toBe(1);
});

test("clicking a group fetches its categories and replaces the treemap contents with just those categories' rectangles", async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  const groupCell = target.querySelector('[data-cell-id="group1"]');
  groupCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const urls = fetchApi.mock.calls.map((call) => call[0]);
  expect(urls.some((u) => u.includes('level=categories') && u.includes('groupId=group1'))).toBe(true);

  expect(target.querySelector('[data-cell-id="cat1"]')).not.toBeNull();
  expect(target.querySelector('[data-cell-id="cat2"]')).not.toBeNull();
  // Group-level cells should no longer be present.
  expect(target.querySelector('[data-cell-id="group1"]')).toBeNull();
  expect(target.querySelector('[data-cell-id="group2"]')).toBeNull();
});

test('a breadcrumb or back control returns from categories to the groups view', async () => {
  mockTwoGroupsWithCategories();

  const target = mountWidget();
  await flush();

  target.querySelector('[data-cell-id="group1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  expect(target.querySelector('[data-cell-id="cat1"]')).not.toBeNull();

  const backControl = target.querySelector('.treemap-back, .breadcrumb-item');
  expect(backControl).not.toBeNull();
  backControl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  expect(target.querySelector('[data-cell-id="group1"]')).not.toBeNull();
  expect(target.querySelector('[data-cell-id="group2"]')).not.toBeNull();
});

test('a group with a single category does not crash the layout', async () => {
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

  target.querySelector('[data-cell-id="group1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();

  const rect = target.querySelector('[data-cell-id="cat1"] rect');
  expect(rect).not.toBeNull();
  expect(Number(rect.getAttribute('width'))).toBeGreaterThan(0);
  expect(Number(rect.getAttribute('height'))).toBeGreaterThan(0);
});

test('a very small rectangle omits its label rather than overflowing', async () => {
  // One dominant group and several tiny ones -- the tiny ones should end up
  // below the 40px-width / 20px-height minimum this widget uses to decide
  // whether to render a <text> label at all (see component comment).
  const manySlices = [
    { id: 'big', label: 'Big Group', amountCents: 990000 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `tiny${i}`, label: `Tiny Group ${i}`, amountCents: 100 })),
  ];

  fetchApi.mockImplementation((url) => {
    if (url.includes('level=groups')) {
      return Promise.resolve(groupsResponse(manySlices));
    }
    return Promise.resolve(jsonResponse({ slices: [] }));
  });

  const target = mountWidget();
  await flush();

  const tinyCell = target.querySelector('[data-cell-id="tiny0"]');
  expect(tinyCell).not.toBeNull();
  expect(tinyCell.querySelector('text')).toBeNull();

  const bigCell = target.querySelector('[data-cell-id="big"]');
  expect(bigCell.querySelector('text')).not.toBeNull();
});

test('zero spending for the month shows a clean empty state', async () => {
  fetchApi.mockImplementation((url) => {
    if (url.includes('level=groups')) {
      return Promise.resolve(groupsResponse([]));
    }
    return Promise.resolve(jsonResponse({ slices: [] }));
  });

  const target = mountWidget();
  await flush();

  expect(target.textContent).toContain('No spending to show.');
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockImplementation(() => Promise.resolve(jsonResponse({}, false, 500)));

  const target = mountWidget();
  await flush();

  const error = target.querySelector('[role="alert"]');
  expect(error).not.toBeNull();
  expect(error.textContent).toContain('500');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockImplementation(() => Promise.reject(new Error('network down')));

  const target = mountWidget();
  await flush();

  const error = target.querySelector('[role="alert"]');
  expect(error).not.toBeNull();
});
