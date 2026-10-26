const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// daysElapsed/daysInMonth math below is day-of-month arithmetic on the
// server's own clock, which is only meaningful if the server's timezone
// matches the household's (the browser computes its `month` query param in
// its own local timezone). Nothing in this container sets TZ by default —
// a typical Docker base image defaults to UTC — so a missing TZ would
// otherwise silently compute wrong numbers (the day flips at UTC midnight
// instead of local midnight) rather than failing loudly. Checked once per
// request (not at module load) so this is both testable and robust to TZ
// being cleared/changed at runtime.
function assertTimezoneConfigured() {
  const tz = process.env.TZ;
  if (!tz || tz.trim().length === 0) {
    const err = new Error(
      'budget-pacing: process.env.TZ is not set. The actualmint-api container must set TZ to the ' +
        "household's timezone (e.g. TZ=America/Denver) so day-of-month math here matches the " +
        "browser's local time. Refusing to silently compute wrong daysElapsed/daysInMonth values."
    );
    err.statusCode = 500;
    throw err;
  }
}

function daysInMonthFor(year, month) {
  // Day 0 of the *next* month is the last day of `month` (1-indexed).
  return new Date(year, month, 0).getDate();
}

// How far "today" (the server's own clock) is into the requested month.
// Never derived from Actual's data — a past month reads as fully elapsed,
// a future month as not yet started.
function computeDays(month) {
  assertTimezoneConfigured();

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysInMonth = daysInMonthFor(year, monthNum);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let daysElapsed;
  if (year === currentYear && monthNum === currentMonth) {
    daysElapsed = now.getDate();
  } else if (year < currentYear || (year === currentYear && monthNum < currentMonth)) {
    daysElapsed = daysInMonth;
  } else {
    daysElapsed = 0;
  }

  return { daysElapsed, daysInMonth };
}

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
function indexCategoriesById(categoryGroups) {
  const byId = new Map();
  for (const group of categoryGroups || []) {
    for (const category of group.categories || []) {
      byId.set(category.id, {
        id: category.id,
        name: category.name,
        groupName: group.name,
        // Both fields are absent on plain income categories; default to 0
        // rather than surface `undefined`/NaN to callers.
        budgeted: category.budgeted ?? 0,
        spent: -(category.spent ?? 0),
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
