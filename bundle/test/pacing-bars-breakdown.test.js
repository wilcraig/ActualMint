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

  expect(target.querySelector('.actualmint-breakdown-modal-backdrop')).toBeNull();

  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(target.querySelector('.actualmint-breakdown-modal-backdrop')).not.toBeNull();

  const lastCall = fetchApi.mock.calls[fetchApi.mock.calls.length - 1];
  expect(lastCall[0]).toContain('level=payees');
  expect(lastCall[0]).toContain('categoryId=catA');
});
