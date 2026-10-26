const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { computeDays } = require('../month-days');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function parseCategoryIds(categories) {
  if (typeof categories !== 'string' || categories.length === 0) {
    return [];
  }
  return categories
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

// Flattens getBudgetMonth()'s categoryGroups into a lookup by category id,
// carrying each category's group name along for display.
//
// Actual stores outflows (spending) as *negative* amounts internally, so
// `category.spent` from @actual-app/api is e.g. -4000 for $40 of real
// spending. This API's public contract is "spent is the household's
// positive outflow for this category this month" (matching how a human
// reads a budget), so we negate it here, once, at the boundary. A
// refund-heavy category with net inflow for the month will end up with a
// negative `spent` after this negation; that's intentional and is handled
// downstream by clamping fillPct to a minimum of 0.
//
// `balance` is passed through unchanged (no sign flip needed -- Actual
// already reports it in "positive means money left" terms). This account's
// budget type is "tracking", where a category with carryover enabled rolls
// its prior month's surplus or deficit into `balance`; one with carryover
// off has `balance === budgeted - spent` for this month alone. Either way,
// `balance + spent` recovers "total available to spend this cycle," which
// is what callers need to pace against instead of the plain monthly
// `budgeted` figure when carryover is in play.
function indexCategoriesById(categoryGroups) {
  const byId = new Map();
  for (const group of categoryGroups || []) {
    for (const category of group.categories || []) {
      byId.set(category.id, {
        id: category.id,
        name: category.name,
        groupId: group.id,
        groupName: group.name,
        // All three fields are absent on plain income categories; default
        // to 0 rather than surface `undefined`/NaN to callers.
        budgeted: category.budgeted ?? 0,
        spent: -(category.spent ?? 0),
        balance: category.balance ?? 0,
      });
    }
  }
  return byId;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month, categories } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    const requestedIds = parseCategoryIds(categories);

    const client = await getActualClient();
    // Keep data from going stale for up to an hour (the recycle interval):
    // refresh from the Actual server before reading, throttled so this
    // doesn't sync on every single request.
    await syncIfDue(client);
    const budgetMonth = await client.getBudgetMonth(month);
    const byId = indexCategoriesById(budgetMonth.categoryGroups);

    // Preserve request order; a requested id absent from the budget is
    // silently omitted rather than erroring.
    const resultCategories = requestedIds.map((id) => byId.get(id)).filter(Boolean);

    const { daysElapsed, daysInMonth } = computeDays(month);

    res.status(200).json({ month, daysElapsed, daysInMonth, categories: resultCategories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
