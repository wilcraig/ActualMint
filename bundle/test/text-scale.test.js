import { PRESETS, loadSavedScale, saveScale, applyScale, nextPreset, STORAGE_KEY } from '../src/text-scale';

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    _store: store,
  };
}

test('loadSavedScale returns the default (13px, Actual\'s own unmodified size) when nothing is saved', () => {
  expect(loadSavedScale(fakeStorage())).toBe(13);
});

test('loadSavedScale returns a previously saved value', () => {
  expect(loadSavedScale(fakeStorage({ [STORAGE_KEY]: '19' }))).toBe(19);
});

test('loadSavedScale falls back to the default on a corrupt stored value', () => {
  expect(loadSavedScale(fakeStorage({ [STORAGE_KEY]: 'not-a-number' }))).toBe(13);
});

test('loadSavedScale falls back to the default when storage access throws (private browsing)', () => {
  const throwingStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
  };
  expect(loadSavedScale(throwingStorage)).toBe(13);
});

test('saveScale writes the value back out as a string', () => {
  const storage = fakeStorage();
  saveScale(storage, 16);
  expect(storage.getItem(STORAGE_KEY)).toBe('16');
});

test('saveScale does not throw when storage access throws', () => {
  const throwingStorage = {
    setItem: () => {
      throw new Error('SecurityError');
    },
  };
  expect(() => saveScale(throwingStorage, 16)).not.toThrow();
});

test('applyScale creates a style element setting html font-size', () => {
  document.head.innerHTML = '';
  applyScale(document, 19);
  const styleEl = document.getElementById('actualmint-text-scale');
  expect(styleEl).not.toBeNull();
  expect(styleEl.textContent).toContain('font-size: 19px');
  expect(styleEl.textContent).toContain('!important');
});

test('applyScale updates the existing style element in place rather than creating a second one', () => {
  document.head.innerHTML = '';
  applyScale(document, 16);
  applyScale(document, 23);
  const styleEls = document.querySelectorAll('#actualmint-text-scale');
  expect(styleEls.length).toBe(1);
  expect(styleEls[0].textContent).toContain('font-size: 23px');
});

test('nextPreset cycles normal -> large -> larger -> largest -> normal', () => {
  expect(nextPreset(13).id).toBe('large');
  expect(nextPreset(16).id).toBe('larger');
  expect(nextPreset(19).id).toBe('largest');
  expect(nextPreset(23).id).toBe('normal');
});

test('nextPreset snaps an off-preset value to the next preset after its closest match', () => {
  // 14 is closest to the 'normal' preset (13) -> next is 'large'.
  expect(nextPreset(14).id).toBe('large');
});

test('PRESETS starts at Actual\'s own default so a user who never touches the control sees no change', () => {
  expect(PRESETS[0].px).toBe(13);
});
