const { formatMoney } = require('../format');
const { VERDICTS, statusFor, paceLine, fractionElapsed, budgetCategories, categoryLine } = require('./pacing-lines');

const MAX_TEXT_LINES = 5;

function overallLine(overall) {
  const { status, spentCents, availableCents, expectedCents } = overall;
  if (status === 'over') return `${VERDICTS.over}: ${formatMoney(spentCents)} spent of ${formatMoney(availableCents)} available`;
  return `${VERDICTS[status]}: ${formatMoney(spentCents)} spent, ${formatMoney(expectedCents)} expected by today`;
}

// Whether spending is on track for how far through the month we are,
// overall and per budget line, over the counted categories (optionally
// narrowed to settings.sections.pacing.categoryIds).
async function build(ctx) {
  const { tolerancePct, categoryIds } = ctx.settings.sections.pacing;
  const only = categoryIds.length > 0 ? new Set(categoryIds) : null;
  const fraction = fractionElapsed(ctx);

  const lines = [];
  for (const [id, category] of await budgetCategories(ctx)) {
    if (!ctx.isCountedCategory(id)) continue;
    if (only && !only.has(id)) continue;
    const line = paceLine(category, ctx.categories.get(id), fraction, tolerancePct);
    // Nothing budgeted and nothing spent: not a budget line this month.
    if (line.availableCents === 0 && line.spentCents === 0) continue;
    lines.push(line);
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
