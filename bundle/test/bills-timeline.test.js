vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import BillsTimeline from '../src/widgets/BillsTimeline.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('renders without a key-collision error when two items share the same scheduleId and date', async () => {
  // Verified via real expandOccurrences output (daily, skipWeekend: true,
  // weekendSolveMode: 'after'): a Saturday, Sunday, and Monday occurrence can
  // all shift onto the same following Monday, producing duplicate
  // (scheduleId, date) pairs in the API response (final-review Fix 2).
  fetchApi.mockResolvedValue(
    jsonResponse({
      items: [
        { scheduleId: 'sched1', payeeName: 'Acme Gym', date: '2026-10-26', amountCents: -1000 },
        { scheduleId: 'sched1', payeeName: 'Acme Gym', date: '2026-10-26', amountCents: -1000 },
      ],
    })
  );

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new BillsTimeline({ target });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rows = target.querySelectorAll('.bills-timeline-row');
  expect(rows).toHaveLength(2);

  const keyCollisionError = consoleError.mock.calls.find((call) =>
    call.some((arg) => typeof arg === 'string' && arg.includes('each_key_duplicate'))
  );
  expect(keyCollisionError).toBeUndefined();

  consoleError.mockRestore();
});
