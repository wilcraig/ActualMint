import {
  FRESH_PALETTE,
  FRESH_COLOR_OVERRIDES,
  applyFreshTheme,
  loadSavedFreshThemeEnabled,
  saveFreshThemeEnabled,
} from '../src/fresh-theme';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
}

beforeEach(() => {
  document.head.innerHTML = '';
});

test('applyFreshTheme(doc, true) creates a style element overriding every palette swatch with !important', () => {
  applyFreshTheme(document, true);
  const styleEl = document.getElementById('insights-fresh-theme');
  expect(styleEl).not.toBeNull();
  for (const [name, value] of Object.entries(FRESH_PALETTE)) {
    expect(styleEl.textContent).toContain(`${name}: ${value} !important;`);
  }
});

test('applyFreshTheme(doc, true) overrides the sidebar colors directly, not just the palette', () => {
  applyFreshTheme(document, true);
  const styleEl = document.getElementById('insights-fresh-theme');
  for (const [name, value] of Object.entries(FRESH_COLOR_OVERRIDES)) {
    expect(styleEl.textContent).toContain(`${name}: ${value} !important;`);
  }
});

test('applyFreshTheme(doc, false) removes the style element', () => {
  applyFreshTheme(document, true);
  applyFreshTheme(document, false);
  expect(document.getElementById('insights-fresh-theme')).toBeNull();
});

test('applyFreshTheme(doc, true) called twice updates the existing element in place', () => {
  applyFreshTheme(document, true);
  applyFreshTheme(document, true);
  expect(document.querySelectorAll('#insights-fresh-theme').length).toBe(1);
});

test('loadSavedFreshThemeEnabled still reads a choice saved before the rename, preferring the new key', () => {
  const legacyOnly = fakeStorage();
  legacyOnly.setItem('actualmint-mint-theme-enabled', 'true');
  expect(loadSavedFreshThemeEnabled(legacyOnly)).toBe(true);

  const both = fakeStorage();
  both.setItem('actualmint-mint-theme-enabled', 'true');
  saveFreshThemeEnabled(both, false);
  expect(loadSavedFreshThemeEnabled(both)).toBe(false);
});

test('loadSavedFreshThemeEnabled defaults to false when nothing is saved', () => {
  expect(loadSavedFreshThemeEnabled(fakeStorage())).toBe(false);
});

test('saveFreshThemeEnabled persists the choice for loadSavedFreshThemeEnabled to read back', () => {
  const storage = fakeStorage();
  saveFreshThemeEnabled(storage, true);
  expect(loadSavedFreshThemeEnabled(storage)).toBe(true);
  saveFreshThemeEnabled(storage, false);
  expect(loadSavedFreshThemeEnabled(storage)).toBe(false);
});
