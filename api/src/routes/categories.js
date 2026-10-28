const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');

const router = express.Router();

// 'YYYY-MM' for "the month we're in right now", from the server clock (same
// convention as goals.js's currentMonth()). getBudgetMonth needs a month, and
// carryover is a per-month flag, so the flag we report is this month's.
function currentMonth() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// Indexes getBudgetMonth()'s nested categories by id, the same fetch-once,
// index-by-id, join-in-JS pattern spending-breakdown.js's indexById() uses.
// Only the carryover flag is kept: it's the one per-month field this route adds.
function indexCarryoverById(budgetMonth) {
  const byId = new Map();
  for (const group of budgetMonth?.categoryGroups || []) {
    for (const category of group.categories || []) {
      byId.set(category.id, { carryover: Boolean(category.carryover) });
    }
  }
  return byId;
}

// Flattens Actual's category groups into a plain list for the widget-builder
// picker. Hidden groups are dropped entirely, and hidden categories are
// dropped even when their group is visible.
router.get('/', async (req, res, next) => {
  try {
    const client = await getActualClient();
    // Keep the list from going stale for up to an hour (the recycle
    // interval): refresh from the Actual server before reading, throttled
    // so this doesn't sync on every single request. A category someone
    // just created in Actual should show up without waiting that long.
    await syncIfDue(client);
    const categoryGroups = await client.getCategoryGroups();
    // Carryover is a best-effort extra: if the budget fetch fails, the picker
    // still gets every category, all reading carryoverEnabled: false.
    let carryoverById = new Map();
    try {
      const budgetMonth = await client.getBudgetMonth(currentMonth());
      carryoverById = indexCarryoverById(budgetMonth);
    } catch (budgetErr) {
      console.warn('categories: getBudgetMonth failed, defaulting carryoverEnabled to false', budgetErr);
    }

    const categories = [];
    for (const group of categoryGroups || []) {
      if (group.hidden) {
        continue;
      }
      for (const category of group.categories || []) {
        if (category.hidden) {
          continue;
        }
        categories.push({
          id: category.id,
          name: category.name,
          groupName: group.name,
          // A category missing from this month's budget data reads as off.
          carryoverEnabled: carryoverById.get(category.id)?.carryover ?? false,
        });
      }
    }

    res.status(200).json({ categories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
