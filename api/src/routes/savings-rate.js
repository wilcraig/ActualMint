const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');
const { daysInMonthFor } = require('../month-days');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// Same comma-separated-ids convention as spending-breakdown.js's own
// parseIdList (and budget-pacing.js's `categories` query parameter) --
// applied here to `investmentGroupIds`.
function parseIdList(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

// First and last calendar day of `month` (YYYY-MM), as AQL date-range
// bounds -- same simple string-math approach as spending-breakdown.js's and
// burn-rate.js's own monthBounds(), duplicated locally per this codebase's
// established small-duplicated-date-helper convention.
function monthBounds(month) {
  const [yearStr, monthStr] = month.split('-');
  const lastDay = daysInMonthFor(Number(yearStr), Number(monthStr));
  const pad = (n) => String(n).padStart(2, '0');
  return {
    monthStart: `${yearStr}-${monthStr}-01`,
    monthEnd: `${yearStr}-${monthStr}-${pad(lastDay)}`,
  };
}

// Runs a non-grouped AQL $sum over `amount` for `filter` and returns the raw
// (possibly negative, Actual-internal-sign) total. An AQL aggregate with no
// matching rows still comes back as a single row (the $sum of nothing is
// 0), but this defensively falls back to 0 for an empty result set too, the
// same "missing data is 0" convention burn-rate.js's sumAmountsByDate and
// sumBudgetedCents both use.
async function sumRawAmountCents(client, filter) {
  const { data } = await client.aqlQuery(
    q('transactions')
      .filter(filter)
      .select([{ amountCents: { $sum: '$amount' } }])
  );
  const row = data && data[0];
  return row && row.amountCents != null ? row.amountCents : 0;
}

// Actual stores outflows (spending) as *negative* amounts internally (same
// convention documented in spending-breakdown.js's toPositiveSpendingCents),
// so a raw $sum over outflow-only transactions comes back negative. This
// API's contract is "outflowCents/investmentCents are positive", so this
// negates once here, at the boundary.
function toPositiveCents(rawAmountCents) {
  return -(rawAmountCents ?? 0);
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month, investmentGroupIds } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const { monthStart, monthEnd } = monthBounds(month);
    // Same transfer_id/tombstone exclusions as spending-breakdown.js's and
    // burn-rate.js's own baseFilter -- a transfer isn't income or spending,
    // and a tombstoned (deleted) transaction shouldn't count either.
    const dateRangeFilter = { date: { $gte: monthStart, $lte: monthEnd }, tombstone: false, transfer_id: null };

    // incomeCents: the INVERSE of spending-breakdown.js's usual
    // `category.group.is_income: false` exclusion -- everything FROM an
    // income group, for the month.
    const incomeFilter = { ...dateRangeFilter, 'category.group.is_income': true };

    // outflowCents: the exact same baseFilter shape spending-breakdown.js
    // uses for spending (is_income: false, transfer_id: null).
    const outflowFilter = { ...dateRangeFilter, 'category.group.is_income': false };

    const investmentGroupIdList = parseIdList(investmentGroupIds);

    const [rawIncomeCents, rawOutflowCents] = await Promise.all([
      sumRawAmountCents(client, incomeFilter),
      sumRawAmountCents(client, outflowFilter),
    ]);

    const incomeCents = rawIncomeCents;
    const outflowCents = toPositiveCents(rawOutflowCents);

    // investmentCents: the same outflow query, additionally restricted to
    // exactly the given groups (same `$oneof` convention
    // spending-breakdown.js's `groupIds` param already uses for
    // breakdownByGroups) -- or 0 without querying at all when the list is
    // empty, same as spending-breakdown.js's "no groupIds means no
    // restriction" convention, inverted here to "no investmentGroupIds
    // means no investment add-back". A stale/deleted group id in the list
    // isn't an error: $oneof against a nonexistent id just matches zero
    // transactions, the same silent-omission behavior
    // spending-breakdown.js's groupIds param already has.
    let investmentCents = 0;
    if (investmentGroupIdList.length > 0) {
      const investmentFilter = { ...outflowFilter, 'category.group': { $oneof: investmentGroupIdList } };
      const rawInvestmentCents = await sumRawAmountCents(client, investmentFilter);
      investmentCents = toPositiveCents(rawInvestmentCents);
    }

    const rate = incomeCents === 0 ? null : (incomeCents - outflowCents + investmentCents) / incomeCents;

    res.status(200).json({ incomeCents, outflowCents, investmentCents, rate });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
