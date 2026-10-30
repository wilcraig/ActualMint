vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
}));

import GeneralTab from '../src/insights-page/GeneralTab.svelte';
import { STORAGE_KEY as TEXT_SCALE_KEY } from '../src/text-scale';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="host"></div>';
  window.localStorage.clear();
});

test('mounts the text-size pills and Mint-theme checkbox, applying the saved defaults', async () => {
  new GeneralTab({ target: document.getElementById('host') });
  await Promise.resolve();

  const normalPill = document.getElementById('actualmint-text-size-pill-normal');
  expect(normalPill).not.toBeNull();
  expect(normalPill.getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-large').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('actualmint-text-scale').textContent).toContain('zoom: 1');

  const checkbox = document.querySelector('input[type="checkbox"]');
  expect(checkbox.checked).toBe(false);
  expect(document.getElementById('insights-fresh-theme')).toBeNull();
});

test('loads a text size and theme choice saved before the rename (old storage keys)', async () => {
  window.localStorage.setItem('actualmint:textScalePx', '19');
  window.localStorage.setItem('actualmint-mint-theme-enabled', 'true');
  new GeneralTab({ target: document.getElementById('host') });
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-size-pill-larger').getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${19 / 13}`);
  expect(document.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(document.getElementById('insights-fresh-theme')).not.toBeNull();
});

test('clicking a text-size pill applies and persists the new size', async () => {
  new GeneralTab({ target: document.getElementById('host') });
  await Promise.resolve();

  const largePill = document.getElementById('actualmint-text-size-pill-large');
  largePill.click();
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${16 / 13}`);
  expect(window.localStorage.getItem(TEXT_SCALE_KEY)).toBe('16');
  expect(largePill.getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal').getAttribute('aria-pressed')).toBe('false');
});

test('toggling the Fresh theme checkbox applies and persists the choice', async () => {
  new GeneralTab({ target: document.getElementById('host') });
  await Promise.resolve();

  const checkbox = document.querySelector('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('insights-fresh-theme')).not.toBeNull();
  expect(window.localStorage.getItem('insights:freshThemeEnabled')).toBe('true');

  checkbox.checked = false;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('insights-fresh-theme')).toBeNull();
  expect(window.localStorage.getItem('insights:freshThemeEnabled')).toBe('false');
});

test('shows a "General" heading and no longer carries the old card title or collapse toggle', async () => {
  new GeneralTab({ target: document.getElementById('host') });
  await Promise.resolve();

  expect(document.querySelector('.section-title').textContent).toBe('General');
  expect(document.body.textContent).not.toContain('Actual Insights');
  expect(document.querySelector('.section-toggle')).toBeNull();
});
