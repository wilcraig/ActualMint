const { q } = require('@actual-app/api');

const { dateRange } = require('../../aql-date-range');
const { formatMoney } = require('../format');
const { addDays, formatDay } = require('../period');

// How far back New Since Last Summary looks for transactions it hasn't
// reported yet. Bank imports land days after the transaction date, so the
// window reaches past the last send instead of starting at it.
const LATE_IMPORT_LOOKBACK_DAYS = 14;

function lookbackStart(ctx) {
  const { period } = ctx;
  if (period.kind !== 'since-last' || !ctx.lastSentAt) return period.start;
  const floor = formatDay(addDays(ctx.now, -LATE_IMPORT_LOOKBACK_DAYS));
  return floor < period.start ? floor : period.start;
}

function textLine(item) {
  const highlight = item.inHighlight ? ' [this week]' : '';
  return `${item.date} ${item.payee}: ${formatMoney(item.amountCents)} (${item.categoryName})${highlight}`;
}

// The biggest spending transactions in the delivery's period. Counted the
// way the charts count: no linked transfers, starting balances, income or
// Transfers-group categories; excluded categories and payees never appear,
// and (by default) neither does anything matched to a schedule, since
// expected payments would crowd out the surprises.
async function build(ctx) {
  const { count, minAmountCents, excludeScheduled } = ctx.settings.sections.largest;
  const { period } = ctx;
  const sinceLast = period.kind === 'since-last';

  const [{ data: rows }, { data: payees }, accounts] = await Promise.all([
    ctx.client.aqlQuery(
      q('transactions')
        .filter({
          ...dateRange(lookbackStart(ctx), period.end),
          tombstone: false,
          transfer_id: null,
          starting_balance_flag: false,
          amount: { $lt: 0 },
        })
        .select(['id', 'date', 'amount', 'payee', 'category', 'account', 'schedule', 'transfer_id', 'starting_balance_flag'])
        .options({ splits: 'inline' })
    ),
    ctx.client.aqlQuery(q('payees').select('*')),
    ctx.client.getAccounts(),
  ]);

  const payeeNames = new Map((payees || []).map((p) => [p.id, p.name]));
  const accountNames = new Map((accounts || []).map((a) => [a.id, a.name]));

  // The query filters these too; checked again here so the rules hold
  // whatever the query layer does with them.
  const candidates = (rows || []).filter(
    (row) =>
      row.amount < 0 &&
      !row.transfer_id &&
      !row.starting_balance_flag &&
      ctx.isCountedCategory(row.category) &&
      !ctx.isExcludedPayee(row.payee) &&
      !(excludeScheduled && row.schedule) &&
      !(sinceLast && ctx.reportedIds.has(row.id))
  );

  const items = candidates
    .filter((row) => -row.amount >= minAmountCents)
    .sort((a, b) => a.amount - b.amount || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, count)
    .map((row) => ({
      id: row.id,
      date: row.date,
      payee: payeeNames.get(row.payee) || '(No payee)',
      categoryName: ctx.categories.get(row.category).name,
      accountName: accountNames.get(row.account) || '',
      amountCents: -row.amount,
      inHighlight: Boolean(period.highlightStart) && row.date >= period.highlightStart,
    }));

  // For New Since Last Summary every new candidate counts as seen once this
  // summary goes out, not only the few shown; otherwise a transaction that
  // just missed the cut would come back later as "new". Other periods only
  // record what they showed.
  const reportedIds = sinceLast ? candidates.map((row) => row.id) : items.map((item) => item.id);

  if (items.length === 0) return null;
  return { data: { items }, lines: items.map(textLine), reportedIds };
}

module.exports = { id: 'largest', title: 'Largest transactions', build };
