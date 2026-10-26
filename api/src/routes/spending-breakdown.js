const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');
const { daysInMonthFor } = require('../month-days');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const VALID_LEVELS = new Set(['groups', 'categories', 'payees']);

// First and last calendar day of `month` (YYYY-MM), as AQL date-range
// bounds. Deliberately simple string math (not a Date object, and not a
// loot-core import) — `transactions.date` is a plain `YYYY-MM-DD` string
// field in the AQL schema, so this just needs to produce the right strings,
// the same reasoning behind month-days.js's daysInMonthFor() helper, reused
// here for the "last day" calculation.
function monthBounds(month) {
  const [yearStr, monthStr] = month.split('-');
  const lastDay = daysInMonthFor(Number(yearStr), Number(monthStr));
  const pad = (n) => String(n).padStart(2, '0');
  return {
    monthStart: `${yearStr}-${monthStr}-01`,
    monthEnd: `${yearStr}-${monthStr}-${pad(lastDay)}`,
  };
}

// Indexes a `select('*')` row array by id — the same "fetch once, index by
// id, join in JS" pattern budget-pacing.js's indexCategoriesById()
// establishes, generalized here for whichever lookup table a given level
// needs (category_groups / categories / payees).
function indexById(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    byId.set(row.id, row);
  }
  return byId;
}

// Actual stores outflows (spending) as *negative* amounts internally (same
// convention documented in budget-pacing.js's indexCategoriesById()), so an
// AQL $sum over `amount` for a slice of spending-heavy transactions comes
// back negative. This API's contract is "amountCents is positive spending",
// so we negate once here, at the boundary.
function toPositiveSpendingCents(rawAmountCents) {
  return -(rawAmountCents ?? 0);
}

// Builds the final slice list from raw grouped AQL rows: negates each row's
// amount into positive spending cents, resolves its id/label via
// `resolveIdentity` (level-specific — joins against the right lookup
// table), and omits zero-activity and net-inflow slices (amountCents <= 0
// after negation) — the donut shows spending, not net flow. A row whose
// identity can't be resolved (e.g. an uncategorized transaction with no
// group/category) is also omitted, since it has nothing to label.
function buildSlices(rows, resolveIdentity) {
  const slices = [];
  for (const row of rows || []) {
    const amountCents = toPositiveSpendingCents(row.amountCents);
    if (amountCents <= 0) continue;

    const identity = resolveIdentity(row);
    if (!identity) continue;

    slices.push({ id: identity.id, label: identity.label, amountCents });
  }
  return slices;
}

async function breakdownByGroups(client, baseFilter) {
  const [{ data: rows }, { data: groupRows }] = await Promise.all([
    client.aqlQuery(
      q('transactions')
        .filter({ ...baseFilter, 'category.group.is_income': false })
        .groupBy('category.group')
        .select([{ groupId: 'category.group' }, { amountCents: { $sum: '$amount' } }])
    ),
    client.aqlQuery(q('category_groups').select('*')),
  ]);

  const groupsById = indexById(groupRows);

  return buildSlices(rows, (row) => {
    const group = groupsById.get(row.groupId);
    return group ? { id: row.groupId, label: group.name } : null;
  });
}

async function breakdownByCategories(client, baseFilter, groupId) {
  const [{ data: rows }, { data: categoryRows }] = await Promise.all([
    client.aqlQuery(
      q('transactions')
        .filter({ ...baseFilter, 'category.group': groupId })
        .groupBy('category')
        .select([{ categoryId: 'category' }, { amountCents: { $sum: '$amount' } }])
    ),
    client.aqlQuery(q('categories').select('*')),
  ]);

  const categoriesById = indexById(categoryRows);

  return buildSlices(rows, (row) => {
    const category = categoriesById.get(row.categoryId);
    return category ? { id: row.categoryId, label: category.name } : null;
  });
}

async function breakdownByPayees(client, baseFilter, categoryId) {
  const [{ data: rows }, { data: payeeRows }] = await Promise.all([
    client.aqlQuery(
      q('transactions')
        .filter({ ...baseFilter, category: categoryId })
        .groupBy('payee')
        .select([{ payeeId: 'payee' }, { amountCents: { $sum: '$amount' } }])
    ),
    client.aqlQuery(q('payees').select('*')),
  ]);

  const payeesById = indexById(payeeRows);

  return buildSlices(rows, (row) => {
    // A transaction with no payee (e.g. a starting-balance entry) groups
    // under a null payee id; surface it as its own labeled slice rather than
    // dropping it or crashing on a missing lookup.
    if (row.payeeId == null) {
      return { id: null, label: '(No payee)' };
    }
    const payee = payeesById.get(row.payeeId);
    return payee ? { id: row.payeeId, label: payee.name } : null;
  });
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month, level, groupId, categoryId } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    if (typeof level !== 'string' || !VALID_LEVELS.has(level)) {
      res.status(400).json({ error: "level query parameter must be one of 'groups', 'categories', 'payees'" });
      return;
    }

    if (level === 'categories' && !groupId) {
      res.status(400).json({ error: 'groupId is required for level=categories' });
      return;
    }

    if (level === 'payees' && !categoryId) {
      res.status(400).json({ error: 'categoryId is required for level=payees' });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const { monthStart, monthEnd } = monthBounds(month);
    const baseFilter = { date: { $gte: monthStart, $lte: monthEnd }, tombstone: false };

    let slices;
    if (level === 'groups') {
      slices = await breakdownByGroups(client, baseFilter);
    } else if (level === 'categories') {
      slices = await breakdownByCategories(client, baseFilter, groupId);
    } else {
      slices = await breakdownByPayees(client, baseFilter, categoryId);
    }

    const total = slices.reduce((sum, slice) => sum + slice.amountCents, 0);

    res.status(200).json({ total, slices });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
