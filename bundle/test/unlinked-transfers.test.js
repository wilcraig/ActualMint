vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../src/api-client';
import UnlinkedTransfers from '../src/widgets/UnlinkedTransfers.svelte';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mountWidget() {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new UnlinkedTransfers({ target });
  return target;
}

beforeEach(() => {
  fetchApi.mockReset();
});

test('shows a clean message when there are no candidates', async () => {
  fetchApi.mockResolvedValue(jsonResponse({ rangeStart: '2026-05-01', rangeEnd: '2026-10-26', candidates: [] }));

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('No unlinked transfer pairs found');
});

test('lists each candidate pair with amount, accounts and dates', async () => {
  fetchApi.mockResolvedValue(
    jsonResponse({
      rangeStart: '2026-05-01',
      rangeEnd: '2026-10-26',
      candidates: [
        {
          amountCents: 1405339,
          first: { id: 'k1', account: 'card', date: '2026-10-23', accountName: 'Chase Sapphire' },
          second: { id: 'c1', account: 'checking', date: '2026-10-26', accountName: 'Checking' },
        },
      ],
    })
  );

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent.replace(/\s+/g, ' ')).toContain('1 pair');
  expect(target.textContent).toContain('$14,053.39');
  expect(target.textContent).toContain('Chase Sapphire');
  expect(target.textContent).toContain('Checking');
  expect(target.querySelectorAll('.unlinked-item').length).toBe(1);
});

test('renders the inline error treatment on a non-ok response', async () => {
  fetchApi.mockResolvedValue(jsonResponse(null, false, 500));

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('Unlinked transfers unavailable (500)');
});

test('renders the inline error treatment when fetch throws', async () => {
  fetchApi.mockRejectedValue(new Error('network down'));

  const target = mountWidget();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(target.textContent).toContain('could not reach insights-api');
});
