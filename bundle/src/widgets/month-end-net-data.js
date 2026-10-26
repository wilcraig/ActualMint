// Pure data-shaping for the Month-End Net widget: turns the projected net
// figure (integer cents, from /api/month-end-projection) into the CSS
// modifier class used to color-code it — no DOM, no fetch, so it's cheap to
// unit test independently of MonthEndNet.svelte.

/**
 * @param {number} projectedNetCents
 * @returns {'positive' | 'negative' | 'zero'}
 */
export function netSignClass(projectedNetCents) {
  if (projectedNetCents > 0) return 'positive';
  if (projectedNetCents < 0) return 'negative';
  return 'zero';
}
