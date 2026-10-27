// Actual's own budget-icon button (the small logo/icon next to the budget's
// name at the top of the sidebar) renders its icon image with
// `object-fit: cover` inside a box sized narrower than tall (~20x30px,
// confirmed by live inspection). A custom uploaded logo whose own aspect
// ratio doesn't match that box gets its left and right edges cropped off by
// `cover` to fill the box -- visually indistinguishable from the image
// having flat vertical borders cut into it. `contain` shows the whole image
// uncropped instead (letterboxed top/bottom if needed, but never cropped
// left/right).

const STYLE_ELEMENT_ID = 'actualmint-budget-icon-fix';

export function fixBudgetIconCrop(doc) {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const styleEl = doc.createElement('style');
  styleEl.id = STYLE_ELEMENT_ID;
  styleEl.textContent = '.budget-icon-img { object-fit: contain !important; }';
  doc.head.appendChild(styleEl);
}
