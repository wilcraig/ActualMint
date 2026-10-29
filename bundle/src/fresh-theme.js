// Actual exposes its entire color system as two layers of CSS custom
// properties: a small set of raw swatches (`--palette-*`, e.g.
// `--palette-blue500: #2b8fed`) and a much larger set of semantic tokens
// (`--color-*`, e.g. `--color-pageBackground: var(--palette-navy100)`) that
// reference them with `var()`. Confirmed by live inspection: redefining the
// ~90 `--palette-*` swatches re-colors every semantic token built from them,
// without touching the hundreds of `--color-*` names individually.
//
// Actual swaps themes (light/dark/midnight) by replacing the contents of its
// own `<style>` element rather than toggling a `data-theme` attribute
// selector, so there is no stable selector to hook a competing theme onto.
// `!important` sidesteps that entirely -- it wins regardless of which theme
// is active or where in `<head>` Actual's style tag happens to sit.

const STYLE_ELEMENT_ID = 'insights-fresh-theme';
export const STORAGE_KEY = 'insights:freshThemeEnabled';
// Saved under the project's original name; still read so an existing
// choice survives the rename.
export const LEGACY_STORAGE_KEY = 'actualmint-mint-theme-enabled';

// The "Fresh" palette: a teal-green brand color (replacing Actual's default
// blue) as the primary interactive color, a soft green-tinted cream page
// chrome (replacing Actual's default navy-tinted light background), and a
// categorical chart palette anchored on the same teal for pacing bars and
// drill-down donuts.
export const FRESH_PALETTE = {
  '--palette-blue50': '#f1fbf8',
  '--palette-blue100': '#d7f3ea',
  '--palette-blue150': '#b7e8d9',
  '--palette-blue200': '#8ddbc3',
  '--palette-blue300': '#5cc8a8',
  '--palette-blue400': '#34b48e',
  '--palette-blue500': '#189e74',
  '--palette-blue600': '#0f8762',
  '--palette-blue700': '#0b6f50',
  '--palette-blue800': '#07573e',
  '--palette-blue900': '#04402d',

  '--palette-navy50': '#fbfdfb',
  '--palette-navy100': '#f0f8f3',
  '--palette-navy150': '#e2f1e8',
  '--palette-navy200': '#cde8d8',
  '--palette-navy300': '#a9d4bd',
  '--palette-navy400': '#7bb89c',
  '--palette-navy500': '#4e9478',
  '--palette-navy600': '#35755c',
  '--palette-navy700': '#255944',
  '--palette-navy800': '#163d2d',
  '--palette-navy900': '#0b2419',

  '--palette-green500': '#1fae65',

  '--palette-hover': 'rgba(24, 158, 116, 0.08)',
  '--palette-border': '#d7e9df',
  '--palette-selected': '#189e74',

  '--palette-chartQual1': '#189e74',
  '--palette-chartQual2': '#f2a74b',
  '--palette-chartQual3': '#6d7fd1',
  '--palette-chartQual4': '#e07a5f',
  '--palette-chartQual5': '#c9a227',
  '--palette-chartQual6': '#8d6fb8',
  '--palette-chartQual7': '#4f9f8a',
  '--palette-chartQual8': '#d1618a',
  '--palette-chartQual9': '#5a7684',
};

// A couple of semantic `--color-*` tokens, overridden directly instead of
// through the palette above. Confirmed live: Actual's sidebar hardcodes
// `--color-sidebarBackground: var(--palette-navy900)`, so recoloring navy900
// (the dark end of the teal ramp above) also turned the sidebar a dark
// forest green -- jarring next to the rest of the now-light, airy page.
// Overriding these two tokens directly keeps the sidebar a neutral light
// gray without touching navy900 itself, which other elements still use
// (and which this theme needs to keep dark for contrast elsewhere).
export const FRESH_COLOR_OVERRIDES = {
  '--color-sidebarBackground': '#f2f4f3',
  '--color-sidebarItemText': '#0b2419',
};

function buildCss() {
  const allDecls = { ...FRESH_PALETTE, ...FRESH_COLOR_OVERRIDES };
  const decls = Object.entries(allDecls)
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(' ');
  return `:root { ${decls} }`;
}

export function applyFreshTheme(doc, enabled) {
  let styleEl = doc.getElementById(STYLE_ELEMENT_ID);
  if (enabled) {
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = STYLE_ELEMENT_ID;
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = buildCss();
  } else if (styleEl) {
    styleEl.remove();
  }
}

export function loadSavedFreshThemeEnabled(storage) {
  return (storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY)) === 'true';
}

export function saveFreshThemeEnabled(storage, enabled) {
  storage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}
