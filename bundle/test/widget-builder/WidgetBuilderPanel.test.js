import { tick } from 'svelte';
import WidgetBuilderPanel from '../../src/widget-builder/WidgetBuilderPanel.svelte';

vi.mock('../../src/api-client', () => ({
  fetchApi: vi.fn(),
}));

import { fetchApi } from '../../src/api-client';

function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return new WidgetBuilderPanel({ target });
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

async function flush() {
  // Let pending microtasks (the async loadPickerData fetch/json chain) and
  // Svelte's own reactive updates settle.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await tick();
}

function open() {
  document.querySelector('.actualmint-wb-toggle').click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/reports/custom');
  fetchApi.mockReset();
});

// selectWidget() fetches picker data eagerly at mount time (regardless of
// whether the panel is open yet), so every test's first fetch happens
// during mount() + flush(), before the panel is ever opened.

test('refetches picker data on open after a prior failure, but not after a success', async () => {
  fetchApi.mockResolvedValueOnce({ ok: false, status: 500 }); // initial load at mount
  mount();
  await flush();
  expect(fetchApi).toHaveBeenCalledTimes(1);

  // Opening after a failed load should retry.
  fetchApi.mockResolvedValueOnce({ ok: false, status: 500 });
  open();
  await flush();
  expect(fetchApi).toHaveBeenCalledTimes(2);
  expect(document.querySelector('.actualmint-wb-error')).not.toBeNull();

  // Close, then reopen with a mock queued that succeeds.
  open(); // close
  await flush();
  fetchApi.mockResolvedValueOnce(okJson({ categories: [{ id: 'c1', name: 'Groceries' }] }));
  open(); // reopen after failure -> refetch #3, succeeds
  await flush();
  expect(fetchApi).toHaveBeenCalledTimes(3);
  expect(document.querySelector('.actualmint-wb-error')).toBeNull();

  // Close and reopen again: last attempt succeeded, so no further refetch.
  open();
  await flush();
  open();
  await flush();
  expect(fetchApi).toHaveBeenCalledTimes(3);
});

test('shows an error when the response body has no usable array', async () => {
  fetchApi.mockResolvedValueOnce(okJson({ categories: 'not-an-array' }));
  mount();
  await flush();
  open();
  await flush();

  expect(document.querySelector('.actualmint-wb-loading')).toBeNull();
  expect(document.querySelector('.actualmint-wb-error')).not.toBeNull();
});

test('filters options by name and group as the user types', async () => {
  fetchApi.mockResolvedValueOnce(
    okJson({
      categories: [
        { id: 'c1', name: 'Groceries', groupName: 'Everyday' },
        { id: 'c2', name: 'Rent', groupName: 'Fixed' },
      ],
    }),
  );
  mount();
  await flush();
  open();
  await flush();

  expect(document.querySelectorAll('.actualmint-wb-options li').length).toBe(2);

  const filterInput = document.querySelector('.actualmint-wb-filter');
  filterInput.value = 'fixed';
  filterInput.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();

  const items = document.querySelectorAll('.actualmint-wb-options li');
  expect(items.length).toBe(1);
  expect(items[0].textContent).toContain('Rent');
});

test('Generate is disabled until a field with options has a selection', async () => {
  fetchApi.mockResolvedValueOnce(
    okJson({ categories: [{ id: 'c1', name: 'Groceries' }] }),
  );
  mount();
  await flush();
  open();
  await flush();

  const generateButton = document.querySelector('.actualmint-wb-generate');
  expect(generateButton.disabled).toBe(true);

  document.querySelector('.actualmint-wb-options input[type="checkbox"]').click();
  await flush();
  expect(generateButton.disabled).toBe(false);
});

test('Generate selects the textarea contents once a selection is made', async () => {
  fetchApi.mockResolvedValueOnce(
    okJson({ categories: [{ id: 'c1', name: 'Groceries' }] }),
  );
  mount();
  await flush();
  open();
  await flush();

  document.querySelector('.actualmint-wb-options input[type="checkbox"]').click();
  await flush();

  const textarea = document.querySelector('.actualmint-wb-textarea');
  const selectSpy = vi.spyOn(textarea, 'select');

  document.querySelector('.actualmint-wb-generate').click();
  await flush();

  expect(selectSpy).toHaveBeenCalled();
  expect(textarea.value).toBe('{{ACTUALMINT:pacing-bars:["c1"]}}');
});
