// Mounts the widget-builder panel into the page. Mirrors the
// mountWidget/Svelte-constructor pattern index.js already uses for
// PacingBars, but the panel has no placeholder to wait for: it always
// mounts a single floating instance into a fresh div appended to <body>.

/**
 * @param {Document} doc
 * @param {new (opts: { target: Element }) => unknown} PanelComponent
 * @returns {unknown} the constructed component instance
 */
export function mountPanel(doc, PanelComponent) {
  const target = doc.createElement('div');
  doc.body.appendChild(target);
  return new PanelComponent({ target });
}
