const { formatMoney } = require('../format');

const VERDICTS = {
  under: 'Under pace',
  'on-pace': 'On track',
  'off-track': 'Off track',
  over: 'Over budget',
};

const MAX_TEXT_LINES = 5;

// One budget line's pacing, from a getBudgetMonth category. Same numbers as
// the Pacing Bars widget (routes/budget-pacing.js): spent is the positive
// outflow net of refunds, and available is balance + spent so carryover
// counts. Off track means spent is past what the elapsed share of the month
// allows, plus the tolerance; over means spent is past everything available.
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

function overallLine(overall) {
  const { status, spentCents, availableCents, expectedCents } = overall;
  if (status === 'over') return `${VERDICTS.over}: ${formatMoney(spentCents)} spent of ${formatMoney(availableCents)} available`;
  return `${VERDICTS[status]}: ${formatMoney(spentCents)} spent, ${formatMoney(expectedCents)} expected by today`;
}

function categoryLine(line) {
  if (line.status === 'over') {
    return `${line.name}: ${formatMoney(line.spentCents)} spent of ${formatMoney(line.availableCents)} (over by ${formatMoney(line.spentCents - line.availableCents)})`;
  }
  return `${line.name}: ${formatMoney(line.spentCents)} spent of ${formatMoney(line.availableCents)} (${formatMoney(line.expectedCents)} expected by today)`;
}

async function build(ctx) {
  const { tolerancePct, categoryIds } = ctx.settings.sections.pacing;
  const only = categoryIds.length > 0 ? new Set(categoryIds) : null;
  const fraction = ctx.daysInMonth > 0 ? ctx.daysElapsed / ctx.daysInMonth : 0;

  const budgetMonth = await ctx.client.getBudgetMonth(ctx.month);
  const lines = [];
  for (const group of budgetMonth.categoryGroups || []) {
    for (const category of group.categories || []) {
      if (!ctx.isCountedCategory(category.id)) continue;
      if (only && !only.has(category.id)) continue;
      const line = paceLine(category, ctx.categories.get(category.id), fraction, tolerancePct);
      // Nothing budgeted and nothing spent: not a budget line this month.
      if (line.availableCents === 0 && line.spentCents === 0) continue;
      lines.push(line);
    }
  }

  const spentCents = lines.reduce((sum, l) => sum + l.spentCents, 0);
  const availableCents = lines.reduce((sum, l) => sum + l.availableCents, 0);
  const expectedExact = availableCents * fraction;
  const overall = {
    spentCents,
    availableCents,
    expectedCents: Math.round(expectedExact),
    status: statusFor(spentCents, availableCents, expectedExact, tolerancePct),
    fractionElapsed: fraction,
  };

  const overage = (l) => l.spentCents - l.expectedCents;
  const offTrack = lines
    .filter((l) => l.status === 'off-track' || l.status === 'over')
    .sort((a, b) => overage(b) - overage(a));

  const groupsByName = new Map();
  for (const line of lines) {
    const entry = groupsByName.get(line.groupName) || { groupName: line.groupName, spentCents: 0, availableCents: 0 };
    entry.spentCents += line.spentCents;
    entry.availableCents += line.availableCents;
    groupsByName.set(line.groupName, entry);
  }

  return {
    data: { overall, offTrack, groups: [...groupsByName.values()] },
    lines: [overallLine(overall), ...offTrack.slice(0, MAX_TEXT_LINES).map(categoryLine)],
  };
}

module.exports = { id: 'pacing', title: 'Pacing', build };
