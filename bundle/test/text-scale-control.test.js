import TextScaleControl from '../src/widgets/TextScaleControl.svelte';
import { STORAGE_KEY } from '../src/text-scale';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="host"></div>';
  window.localStorage.clear();
});

test('mounts a visible button and applies the default (13px) scale on first load', async () => {
  new TextScaleControl({ target: document.getElementById('host') });
  await Promise.resolve();

  const button = document.querySelector('.actualmint-text-scale-button');
  expect(button).not.toBeNull();
  expect(document.getElementById('actualmint-text-scale').textContent).toContain('zoom: 1');
  expect(button.textContent).toContain('Normal');
});

test('loads a previously saved scale instead of the default', async () => {
  window.localStorage.setItem(STORAGE_KEY, '19');
  new TextScaleControl({ target: document.getElementById('host') });
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${19 / 13}`);
  expect(document.querySelector('.actualmint-text-scale-button').textContent).toContain('Larger');
});

test('clicking the button cycles to the next preset and persists it', async () => {
  new TextScaleControl({ target: document.getElementById('host') });
  await Promise.resolve();

  const button = document.querySelector('.actualmint-text-scale-button');
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();

  expect(document.getElementById('actualmint-text-scale').textContent).toContain(`zoom: ${16 / 13}`);
  expect(button.textContent).toContain('Large');
  expect(window.localStorage.getItem(STORAGE_KEY)).toBe('16');
});
