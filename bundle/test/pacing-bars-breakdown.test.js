vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import PacingBars from '../src/widgets/PacingBars.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('each pacing row is a real <button> (keyboard-accessible), and clicking it opens the breakdown modal', async () => {
  fetchApi
    .mockResolvedValueOnce(
      jsonResponse({
        daysElapsed: 10,
        daysInMonth: 30,
        categories: [
          { id: 'catA', name: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses', budgeted: 10000, spent: 4000 },
        ],
      }),
    )
    .mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new PacingBars({ target, props: { categoryIds: ['catA'] } });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const row = target.querySelector('button.pacing-row');
  expect(row).not.toBeNull();
  expect(row.tagName).toBe('BUTTON');

  expect(document.body.querySelector('.actualmint-breakdown-modal-backdrop')).toBeNull();

  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(document.body.querySelector('.actualmint-breakdown-modal-backdrop')).not.toBeNull();

  const lastCall = fetchApi.mock.calls[fetchApi.mock.calls.length - 1];
  expect(lastCall[0]).toContain('level=payees');
  expect(lastCall[0]).toContain('categoryId=catA');
});

test('the opened modal is mounted onto document.body, not inside the widget\'s own DOM subtree', async () => {
  // Confirmed root cause: Actual's Reports page positions each widget's
  // grid-item ancestor with a CSS `transform` (react-grid-layout's default
  // `useCSSTransforms: true`), which per the CSS spec becomes the
  // containing block for any `position: fixed` descendant. The modal's
  // full-screen backdrop relies on `position: fixed` covering the real
  // viewport, so it must never be a descendant of the widget's own root
  // element -- it has to be mounted directly onto document.body instead.
  fetchApi
    .mockResolvedValueOnce(
      jsonResponse({
        daysElapsed: 10,
        daysInMonth: 30,
        categories: [
          { id: 'catA', name: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses', budgeted: 10000, spent: 4000 },
        ],
      }),
    )
    .mockResolvedValue(jsonResponse({ total: 0, slices: [] }));

  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new PacingBars({ target, props: { categoryIds: ['catA'] } });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const row = target.querySelector('button.pacing-row');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const backdrop = document.body.querySelector('.actualmint-breakdown-modal-backdrop');
  expect(backdrop).not.toBeNull();
  // The widget's own root element (direct child of #host) must not
  // contain the backdrop.
  expect(target.contains(backdrop)).toBe(false);
  // It should instead be a direct child of document.body (mounted via
  // Svelte 5's mount(Component, { target: document.body })).
  expect(backdrop.closest('body')).toBe(document.body);
});
