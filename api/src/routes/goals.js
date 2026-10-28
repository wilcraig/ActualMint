const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { readGoals, writeGoals } = require('../goals-store');

const VALID_ENTITY_TYPES = new Set(['category', 'account']);
const TARGET_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM' for "the month we're in right now" -- carryover is a per-month
// flag (see @actual-app/api's handlers$1["api/budget-month"], which computes
// each category's `carryover` from that month's `carryover-${categoryId}`
// spreadsheet cell), and a goal has no month of its own, so the carryover
// check is always against the current month.
function currentMonth() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// Mirrors categories.js's own flattening of getCategoryGroups() -- walks
// every group (hidden or not: a goal against an entity that was later hidden
// should still resolve) looking for a category with this id.
async function resolveCategory(client, entityId) {
  const categoryGroups = await client.getCategoryGroups();
  for (const group of categoryGroups || []) {
    for (const category of group.categories || []) {
      if (category.id === entityId) {
        return category;
      }
    }
  }
  return null;
}

async function resolveAccount(client, entityId) {
  const accounts = await client.getAccounts();
  return (accounts || []).find((account) => account.id === entityId) || null;
}

// Per-category `carryover` is only exposed on the categories nested inside
// getBudgetMonth(month).categoryGroups -- confirmed by reading
// @actual-app/api's api/budget-month handler directly (dist/index.js), which
// builds each category as
// `{ ...categoryModel.toExternal(cat), ..., carryover: value(`carryover-${cat.id}`) }`,
// a boolean spreadsheet cell (set by budget/set-carryover as
// `budget.carryover === 1 ? true : false`). getCategoryGroups() alone (used
// for resolution above) does NOT carry this field -- it's not a per-month
// value there.
async function categoryHasCarryover(client, entityId) {
  const budgetMonth = await client.getBudgetMonth(currentMonth());
  for (const group of budgetMonth.categoryGroups || []) {
    for (const category of group.categories || []) {
      if (category.id === entityId) {
        return Boolean(category.carryover);
      }
    }
  }
  return false;
}

// Returns an error message naming the first invalid field, or null if the
// body is well-formed. Entity resolution and the carryover check happen
// separately, after this passes -- they need the Actual client.
function validateGoalBody(body) {
  if (!body || typeof body !== 'object') {
    return 'body is required';
  }
  const { entityType, entityId, targetAmountCents, targetDate } = body;

  if (!VALID_ENTITY_TYPES.has(entityType)) {
    return "entityType must be 'category' or 'account'";
  }
  if (typeof entityId !== 'string' || entityId.length === 0) {
    return 'entityId must be a non-empty string';
  }
  if (!Number.isInteger(targetAmountCents) || targetAmountCents <= 0) {
    return 'targetAmountCents must be a positive integer';
  }
  if (typeof targetDate !== 'string' || !TARGET_DATE_PATTERN.test(targetDate)) {
    return 'targetDate must be a YYYY-MM-DD string';
  }
  return null;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const goals = await readGoals();
    res.status(200).json({ goals });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const validationError = validateGoalBody(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const { entityType, entityId, targetAmountCents, targetDate } = req.body;

    const client = await getActualClient();
    await syncIfDue(client);

    if (entityType === 'category') {
      const category = await resolveCategory(client, entityId);
      if (!category) {
        res.status(400).json({ error: 'entityId does not resolve to a real category' });
        return;
      }
      const hasCarryover = await categoryHasCarryover(client, entityId);
      if (!hasCarryover) {
        res.status(400).json({ error: 'category does not have carryover enabled' });
        return;
      }
    } else {
      const account = await resolveAccount(client, entityId);
      if (!account) {
        res.status(400).json({ error: 'entityId does not resolve to a real account' });
        return;
      }
    }

    const goal = { id: req.params.id, entityType, entityId, targetAmountCents, targetDate };

    const goals = await readGoals();
    const index = goals.findIndex((g) => g.id === goal.id);
    if (index >= 0) {
      goals[index] = goal;
    } else {
      goals.push(goal);
    }
    await writeGoals(goals);

    res.status(200).json({ goal });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const goals = await readGoals();
    const remaining = goals.filter((g) => g.id !== req.params.id);
    if (remaining.length === goals.length) {
      res.status(404).json({ error: 'goal not found' });
      return;
    }
    await writeGoals(remaining);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
