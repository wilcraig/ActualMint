// Pure data-shaping for the Pacing Bars widget: turns one category's
// {budgeted, spent} (integer cents, from /api/budget-pacing) plus the
// month's {daysElapsed, daysInMonth} into the numbers PacingBars.svelte
// needs to draw a bar — no DOM, no fetch, so it's cheap to unit test.

/**
 * @param {{ budgeted: number, spent: number }} amounts
 * @param {{ daysElapsed: number, daysInMonth: number }} month
 * @returns {{ fillPct: number, tickPct: number, status: 'under' | 'near' | 'over' }}
 */
export function computeBarState({ budgeted, spent }, { daysElapsed, daysInMonth }) {
  const fillPct = budgeted > 0 ? Math.min(spent / budgeted, 1) * 100 : 0;
  const tickPct = (daysElapsed / daysInMonth) * 100;

  let status;
  if (spent > budgeted) {
    status = 'over';
  } else if (fillPct >= 90) {
    status = 'near';
  } else {
    status = 'under';
  }

  return { fillPct, tickPct, status };
}
