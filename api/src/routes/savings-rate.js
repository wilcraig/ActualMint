const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { loadMonthCashFlow } = require('../cash-flow-data');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function parseIdList(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

const router = express.Router();

// The share of the month's income that wasn't spent:
// (income - spending + investment) / income. Income and spending use the
// same rules as the Sankey (see cash-flow-data.js), so the gauge and the
// Sankey's "Saved" node always agree. investmentGroupIds are expense groups
// whose spending is really saving (e.g. a brokerage or 529 contribution),
// added back in. A stale/unknown group id just contributes nothing.
router.get('/', async (req, res, next) => {
  try {
    const { month, investmentGroupIds } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const flow = await loadMonthCashFlow(client, month);
    const investmentIds = new Set(parseIdList(investmentGroupIds));
    const investmentCents = flow.groups
      .filter((group) => investmentIds.has(group.id))
      .reduce((sum, group) => sum + group.amountCents, 0);

    const incomeCents = flow.incomeCents;
    const outflowCents = flow.spendingCents;
    const rate = incomeCents === 0 ? null : (incomeCents - outflowCents + investmentCents) / incomeCents;

    res.status(200).json({ incomeCents, outflowCents, investmentCents, rate });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
