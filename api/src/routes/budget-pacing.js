const express = require('express');

const { getActualClient } = require('../actual-client');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function daysInMonthFor(year, month) {
  // Day 0 of the *next* month is the last day of `month` (1-indexed).
  return new Date(year, month, 0).getDate();
}

// How far "today" (the server's own clock) is into the requested month.
// Never derived from Actual's data — a past month reads as fully elapsed,
// a future month as not yet started.
function computeDays(month) {
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
        spent: category.spent ?? 0,
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
