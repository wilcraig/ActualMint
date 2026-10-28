const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');
const { daysInMonthFor } = require('../month-days');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const VALID_LEVELS = new Set(['groups', 'categories', 'payees', 'transactions']);
// Sentinel for "the no-payee bucket" (see breakdownByPayees' null-payee
// handling below) as a literal query-param value, since a real payeeId is
// always a non-empty string and an actually-absent payeeId already means
// something else (the param wasn't given at all).
const NO_PAYEE_SENTINEL = '__none__';

// Same comma-separated-ids convention as budget-pacing.js's `categories`
// query parameter.
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

// `groupIds`, when non-empty, restricts the breakdown to exactly that list
// of groups (a user-curated subset, e.g. a standalone donut widget
// configured to show only a few groups) instead of every expense group.
async function breakdownByGroups(client, baseFilter, groupIds) {
  const filter = { ...baseFilter, 'category.group.is_income': false };
  if (groupIds.length > 0) {
    filter['category.group'] = { $oneof: groupIds };
  }

  const [{ data: rows }, { data: groupRows }] = await Promise.all([
    client.aqlQuery(
      q('transactions')
        .filter(filter)
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

// A rollup's member categories are an arbitrary, user-curated list that
// doesn't necessarily correspond to any single real Actual group (that's
// the whole point of a rollup), so this groups by `category` directly and
// restricts to exactly that id list, rather than filtering by group
// membership the way breakdownByCategories does.
async function breakdownByCategoryIds(client, baseFilter, categoryIds) {
  const [{ data: rows }, { data: categoryRows }] = await Promise.all([
    client.aqlQuery(
      q('transactions')
        .filter({ ...baseFilter, category: { $oneof: categoryIds } })
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

// Individual transaction line items for one (categoryId, payeeId) pair --
// the leaf level, one step past the payees donut. `payeeId === null` means
// the NO_PAYEE_SENTINEL bucket (see its own comment above). Unlike the
// other three levels, this never calls buildSlices: a transaction list
// isn't donut-slice data, so the route returns it under its own
// `transactions` key instead of `{ total, slices }`.
async function transactionsForCategoryAndPayee(client, baseFilter, categoryId, payeeId) {
  const filter = { ...baseFilter, category: categoryId, payee: payeeId };
  const { data: rows } = await client.aqlQuery(
    q('transactions')
      .filter(filter)
      .select(['id', 'date', 'amount', 'notes', 'imported_payee'])
      .options({ splits: 'inline' })
  );

  return rows
    .map((row) => ({
      id: row.id,
      date: row.date,
      amountCents: toPositiveSpendingCents(row.amount),
      notes: row.notes ?? null,
      importedPayee: row.imported_payee ?? null,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month, level, groupId, categoryId, groupIds, categoryIds, payeeId } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    if (typeof level !== 'string' || !VALID_LEVELS.has(level)) {
      res.status(400).json({ error: "level query parameter must be one of 'groups', 'categories', 'payees', 'transactions'" });
      return;
    }

    // Express's default query parser turns `?groupId[$ne]=x` into an object
    // rather than a string. Reject that here instead of letting it reach
    // the AQL query builder, where it would compile as an operator object
    // rather than a literal filter value.
    //
    // level=categories accepts EITHER groupId (a real Actual group -- the
    // normal drill-down-from-a-single-category path) OR categoryIds (an
    // arbitrary user-curated list -- the rollup-widget path); exactly one
    // of the two is required.
    const categoryIdList = parseIdList(categoryIds);
    if (level === 'categories') {
      const hasGroupId = typeof groupId === 'string' && groupId.length > 0;
      const hasCategoryIds = categoryIdList.length > 0;
      if (hasGroupId === hasCategoryIds) {
        res.status(400).json({ error: 'level=categories requires exactly one of groupId or categoryIds' });
        return;
      }
    }

    if (level === 'payees' && (!categoryId || typeof categoryId !== 'string')) {
      res.status(400).json({ error: 'categoryId is required for level=payees' });
      return;
    }

    if (level === 'transactions') {
      if (!categoryId || typeof categoryId !== 'string') {
        res.status(400).json({ error: 'categoryId is required for level=transactions' });
        return;
      }
      if (!payeeId || typeof payeeId !== 'string') {
        res.status(400).json({ error: 'payeeId is required for level=transactions (use "__none__" for the no-payee bucket)' });
        return;
      }
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const { monthStart, monthEnd } = monthBounds(month);
    // transfer_id: null excludes transfers between accounts at every level
    // of this drill-down -- a transfer isn't spending, and left in, one
    // routinely dominates the donut (a single reconciliation/rebalancing
    // transfer can dwarf real spending categories; this budget's own
    // "Transfers" category group was 58% of the groups-level total before
    // this filter).
    const baseFilter = { date: { $gte: monthStart, $lte: monthEnd }, tombstone: false, transfer_id: null };

    if (level === 'transactions') {
      const transactions = await transactionsForCategoryAndPayee(
        client,
        baseFilter,
        categoryId,
        payeeId === NO_PAYEE_SENTINEL ? null : payeeId
      );
      res.status(200).json({ transactions });
      return;
    }

    let slices;
    if (level === 'groups') {
      slices = await breakdownByGroups(client, baseFilter, parseIdList(groupIds));
    } else if (level === 'categories') {
      slices = categoryIdList.length > 0
        ? await breakdownByCategoryIds(client, baseFilter, categoryIdList)
        : await breakdownByCategories(client, baseFilter, groupId);
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
