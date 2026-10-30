const { categoryLine, linesFor } = require('./pacing-lines');
const { toItem } = require('./watched');

// Chosen categories, shown only when spending has passed everything
// available (not merely ahead of pace). Nothing over -> nothing to report.
async function build(ctx) {
  const over = (await linesFor(ctx, ctx.settings.sections.alerts.categoryIds)).filter(
    (line) => line.availableCents > 0 && line.spentCents > line.availableCents
  );
  if (over.length === 0) return null;
  return { data: { categories: over.map(toItem) }, lines: over.map(categoryLine) };
}

module.exports = { id: 'alerts', title: 'Over budget', build };
