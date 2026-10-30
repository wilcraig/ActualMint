const { formatMoney } = require('../format');
const { VERDICTS, linesFor } = require('./pacing-lines');

const toItem = ({ categoryId, name, spentCents, availableCents, status }) => ({
  categoryId,
  name,
  spentCents,
  availableCents,
  remainingCents: availableCents - spentCents,
  status,
});

function textLine(item) {
  const left = item.remainingCents >= 0 ? `${formatMoney(item.remainingCents)} left` : `over by ${formatMoney(-item.remainingCents)}`;
  return `${item.name}: ${formatMoney(item.spentCents)} of ${formatMoney(item.availableCents)} spent, ${left} (${VERDICTS[item.status].toLowerCase()})`;
}

// Chosen categories, always shown, good or bad, even if also excluded.
async function build(ctx) {
  const categories = (await linesFor(ctx, ctx.settings.sections.watched.categoryIds)).map(toItem);
  if (categories.length === 0) return null;
  return { data: { categories }, lines: categories.map(textLine) };
}

module.exports = { id: 'watched', title: 'Watched categories', build, toItem };
