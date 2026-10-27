import SettingsSection from '../../src/settings-panel/SettingsSection.svelte';
import { STORAGE_KEY as TEXT_SCALE_KEY } from '../../src/text-scale';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="host"></div>';
  window.localStorage.clear();
});

test('mounts the text-size select and Mint-theme checkbox, applying the saved defaults', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const select = document.getElementById('actualmint-text-size-select');
  expect(select).not.toBeNull();
  expect(select.value).toBe('13');
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

  expect(document.getElementById('actualmint-text-size-select').value).toBe('19');
  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${19 / 13}`);
  expect(document.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(document.getElementById('actualmint-mint-theme')).not.toBeNull();
});

test('changing the text-size select applies and persists the new size', async () => {
  new SettingsSection({ target: document.getElementById('host') });
  await Promise.resolve();

  const select = document.getElementById('actualmint-text-size-select');
  select.value = '16';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${16 / 13}`);
  expect(window.localStorage.getItem(TEXT_SCALE_KEY)).toBe('16');
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
