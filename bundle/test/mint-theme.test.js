import {
  MINT_PALETTE,
  applyMintTheme,
  loadSavedMintThemeEnabled,
  saveMintThemeEnabled,
} from '../src/mint-theme';

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

test('applyMintTheme(doc, true) creates a style element overriding every palette swatch with !important', () => {
  applyMintTheme(document, true);
  const styleEl = document.getElementById('actualmint-mint-theme');
  expect(styleEl).not.toBeNull();
  for (const [name, value] of Object.entries(MINT_PALETTE)) {
    expect(styleEl.textContent).toContain(`${name}: ${value} !important;`);
  }
});

test('applyMintTheme(doc, false) removes the style element', () => {
  applyMintTheme(document, true);
  applyMintTheme(document, false);
  expect(document.getElementById('actualmint-mint-theme')).toBeNull();
});

test('applyMintTheme(doc, true) called twice updates the existing element in place', () => {
  applyMintTheme(document, true);
  applyMintTheme(document, true);
  expect(document.querySelectorAll('#actualmint-mint-theme').length).toBe(1);
});

test('loadSavedMintThemeEnabled defaults to false when nothing is saved', () => {
  expect(loadSavedMintThemeEnabled(fakeStorage())).toBe(false);
});

test('saveMintThemeEnabled persists the choice for loadSavedMintThemeEnabled to read back', () => {
  const storage = fakeStorage();
  saveMintThemeEnabled(storage, true);
  expect(loadSavedMintThemeEnabled(storage)).toBe(true);
  saveMintThemeEnabled(storage, false);
  expect(loadSavedMintThemeEnabled(storage)).toBe(false);
});
