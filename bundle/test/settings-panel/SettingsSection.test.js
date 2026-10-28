import SettingsSection from '../../src/settings-panel/SettingsSection.svelte';
import { STORAGE_KEY as TEXT_SCALE_KEY } from '../../src/text-scale';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="host"></div>';
  window.localStorage.clear();
});

test('mounts the text-size pills and Mint-theme checkbox, applying the saved defaults', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const normalPill = document.getElementById('actualmint-text-size-pill-normal');
  expect(normalPill).not.toBeNull();
  expect(normalPill.getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-large').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('actualmint-text-scale').textContent).toContain('zoom: 1');

  const checkbox = document.querySelector('input[type="checkbox"]');
  expect(checkbox.checked).toBe(false);
  expect(document.getElementById('actualmint-mint-theme')).toBeNull();
});

test('loads a previously saved text size and Mint-theme choice', async () => {
  window.localStorage.setItem(TEXT_SCALE_KEY, '19');
  window.localStorage.setItem('actualmint-mint-theme-enabled', 'true');
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-size-pill-larger').getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${19 / 13}`);
  expect(document.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(document.getElementById('actualmint-mint-theme')).not.toBeNull();
});

test('clicking a text-size pill applies and persists the new size', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const largePill = document.getElementById('actualmint-text-size-pill-large');
  largePill.click();
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${16 / 13}`);
  expect(window.localStorage.getItem(TEXT_SCALE_KEY)).toBe('16');
  expect(largePill.getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal').getAttribute('aria-pressed')).toBe('false');
});

test('toggling the Mint-theme checkbox applies and persists the choice', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const checkbox = document.querySelector('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('actualmint-mint-theme')).not.toBeNull();
  expect(window.localStorage.getItem('actualmint-mint-theme-enabled')).toBe('true');

  checkbox.checked = false;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('actualmint-mint-theme')).toBeNull();
  expect(window.localStorage.getItem('actualmint-mint-theme-enabled')).toBe('false');
});

test('defaults to expanded, and clicking the header toggle hides/shows the settings content', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const toggle = document.querySelector('.section-toggle');
  expect(toggle).not.toBeNull();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal')).not.toBeNull();

  toggle.click();
  await Promise.resolve();

  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById('actualmint-text-size-pill-normal')).toBeNull();
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();

  toggle.click();
  await Promise.resolve();

  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById('actualmint-text-size-pill-normal')).not.toBeNull();
});
