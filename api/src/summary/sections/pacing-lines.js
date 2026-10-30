const { formatMoney } = require('../format');

// Shared by Pacing, Watched categories and Over budget so all three report
// the same numbers. Same data as the Pacing Bars widget
// (routes/budget-pacing.js): spent is the positive outflow net of refunds,
// and available is balance + spent so carryover counts. Off track means
// spent is past what the elapsed share of the month allows, plus the
// tolerance; over means spent is past everything available.

const VERDICTS = {
  under: 'Under pace',
  'on-pace': 'On track',
  'off-track': 'Off track',
  over: 'Over budget',
};

function statusFor(spentCents, availableCents, expectedExact, tolerancePct) {
  if (spentCents > 0 && spentCents > availableCents) return 'over';
  if (spentCents > expectedExact * (1 + tolerancePct / 100)) return 'off-track';
  if (spentCents < expectedExact * (1 - tolerancePct / 100)) return 'under';
  return 'on-pace';
}

function paceLine(budgetCategory, info, fraction, tolerancePct) {
  const spentCents = -(budgetCategory.spent ?? 0);
  const availableCents = (budgetCategory.balance ?? 0) + spentCents;
  const expectedExact = availableCents * fraction;
  return {
    categoryId: info.id,
    name: info.name,
    groupName: info.groupName,
    spentCents,
    availableCents,
    expectedCents: Math.round(expectedExact),
    status: statusFor(spentCents, availableCents, expectedExact, tolerancePct),
  };
}

// Share of the current month gone, counting today (day 1 -> 1/n, never 0).
function fractionElapsed(ctx) {
  return ctx.daysInMonth > 0 ? ctx.daysElapsed / ctx.daysInMonth : 0;
}

// The current month's budget categories by id, fetched once per summary
// and shared by every section that needs them.
function budgetCategories(ctx) {
  if (!ctx.budgetCategoriesPromise) {
    ctx.budgetCategoriesPromise = ctx.client.getBudgetMonth(ctx.month).then((budgetMonth) => {
      const byId = new Map();
      for (const group of budgetMonth.categoryGroups || []) {
        for (const category of group.categories || []) byId.set(category.id, category);
      }
      return byId;
    });
  }
  return ctx.budgetCategoriesPromise;
}

// Lines for an explicit list of category ids, in list order, regardless of
// exclusions (watching a category is a deliberate choice). Ids that no
// longer exist are skipped.
async function linesFor(ctx, categoryIds) {
  const byId = await budgetCategories(ctx);
  const fraction = fractionElapsed(ctx);
  const tolerancePct = ctx.settings.sections.pacing.tolerancePct;
  const lines = [];
  for (const id of categoryIds) {
    const budgetCategory = byId.get(id);
    const info = ctx.categories.get(id);
    if (!budgetCategory || !info) continue;
    lines.push(paceLine(budgetCategory, info, fraction, tolerancePct));
  }
  return lines;
}

function categoryLine(line) {
  if (line.status === 'over') {
    return `${line.name}: ${formatMoney(line.spentCents)} spent of ${formatMoney(line.availableCents)} (over by ${formatMoney(line.spentCents - line.availableCents)})`;
  }
  return `${line.name}: ${formatMoney(line.spentCents)} spent of ${formatMoney(line.availableCents)} (${formatMoney(line.expectedCents)} expected by today)`;
}

module.exports = { VERDICTS, statusFor, paceLine, fractionElapsed, budgetCategories, linesFor, categoryLine };
