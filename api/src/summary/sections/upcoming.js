const { upcomingOccurrences } = require('../../bills-data');
const { formatMoney } = require('../format');
const { addDays } = require('../period');

// Bills and credit card payments due from today through the look-ahead
// window, from Actual's schedules (cc-helper keeps card payment amounts
// current there). Payments only; excluded schedules, payees and categories
// never appear.
async function build(ctx) {
  const { lookAheadDays, minAmountCents } = ctx.settings.sections.upcoming;
  const occurrences = await upcomingOccurrences(ctx.client, ctx.now, addDays(ctx.now, lookAheadDays));

  const items = occurrences
    .filter(
      (o) =>
        o.amountCents < 0 &&
        -o.amountCents >= minAmountCents &&
        !ctx.isExcludedSchedule(o.scheduleId) &&
        !ctx.isExcludedPayee(o.payeeId) &&
        !(o.categoryId && ctx.categories.get(o.categoryId)?.excluded)
    )
    .map((o) => ({ scheduleId: o.scheduleId, name: o.name, date: o.date, amountCents: -o.amountCents, accountName: o.accountName }));

  if (items.length === 0) return null;
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const lines = items.map((i) => `${i.date} ${i.name}: ${formatMoney(i.amountCents)}${i.accountName ? ` (${i.accountName})` : ''}`);
  return { data: { items, totalCents }, lines: [...lines, `Total: ${formatMoney(totalCents)}`] };
}

module.exports = { id: 'upcoming', title: 'Coming up', build };
