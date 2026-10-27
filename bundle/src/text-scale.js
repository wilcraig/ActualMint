// Global text-size control — lets each browser/device independently bump up
// the font size of the *entire* page (Actual's own native budget/report UI,
// not just ActualMint's own widgets), since a phone-sized default is too
// small to read. Works because Actual's own CSS sizes everything in `rem`
// off a single `html { font-size: 13px }` base rule (confirmed by live
// inspection) — overriding that one root value cleanly rescales the whole
// app, native UI included, with no per-widget CSS changes needed.
//
// Persisted per-browser in localStorage (not synced through Actual's own
// data), so a phone and a desktop can each keep their own preferred size.

export const STORAGE_KEY = 'actualmint:textScalePx';

// Actual's own unmodified root size is 13px -- "Normal" matches that
// exactly, so a user who never touches this control sees no change at all.
export const PRESETS = [
  { id: 'normal', label: 'Normal', px: 13 },
  { id: 'large', label: 'Large', px: 16 },
  { id: 'larger', label: 'Larger', px: 19 },
  { id: 'largest', label: 'Largest', px: 23 },
];

const DEFAULT_PX = PRESETS[0].px;
const STYLE_ELEMENT_ID = 'actualmint-text-scale';

// Reads the saved size from `storage` (a Storage-like object, e.g.
// window.localStorage). Falls back to the default on anything unusable --
// missing key, corrupt value, or a storage access that throws (private
// browsing / blocked site data) -- rather than ever letting a bad stored
// value break the page.
export function loadSavedScale(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const px = Number(raw);
    if (Number.isFinite(px) && px > 0) return px;
  } catch {
    // storage inaccessible -- fall through to default
  }
  return DEFAULT_PX;
}

export function saveScale(storage, px) {
  try {
    storage.setItem(STORAGE_KEY, String(px));
  } catch {
    // storage inaccessible (private browsing, blocked site data) -- the
    // size still applies for this page load via applyScale(), it just
    // won't persist across reloads. Not worth surfacing as an error.
  }
}

// Applies `px` as the document's root font-size via a single dedicated
// <style> element (created once, updated in place on later calls) rather
// than writing to html.style directly, so this plays nicely alongside any
// other inline styles already on <html> and is trivial to find/remove.
// `!important` guards against Actual's own `html { font-size: 13px }` rule
// winning on load order/specificity.
export function applyScale(doc, px) {
  let styleEl = doc.getElementById(STYLE_ELEMENT_ID);
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(styleEl);
  }
  styleEl.textContent = `html { font-size: ${px}px !important; }`;
}

// The next preset after whichever one's px is closest to `currentPx`,
// wrapping back to the first preset after the last. Used by the control's
// "cycle" click -- a user who has manually tweaked localStorage to an
// off-preset value still lands on a sane next step rather than getting
// stuck.
export function nextPreset(currentPx) {
  let closestIndex = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < PRESETS.length; i++) {
    const diff = Math.abs(PRESETS[i].px - currentPx);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return PRESETS[(closestIndex + 1) % PRESETS.length];
}
