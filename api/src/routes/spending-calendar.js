const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Inclusive day cap on the [start, end] range: one entry per calendar day in
// the response, so an unbounded range would mean an unbounded response body
// (and an unbounded AQL groupBy). 366 covers a full leap year, the longest a
// single-year range can be.
const MAX_RANGE_DAYS = 366;

// Midnight of `date`'s own local calendar day (same stable-boundary pattern
// as account-balances.js's/burn-rate.js's startOfLocalDay).
function parseDateOnly(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Every calendar day from `start` to `end`, inclusive, as YYYY-MM-DD strings
// -- same day-walking approach as account-balances.js's/burn-rate.js's own
// enumerateDays().
function enumerateDays(start, end) {
  const days = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    days.push(formatDate(cursor));
  }
  return days;
}

// Number of calendar days spanned by [start, end], inclusive (so start ===
// end is 1 day, not 0).
function inclusiveDayCount(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

// Buckets grouped-by-date AQL rows into { dateStr: totalRawAmountCents) --
// same shape as burn-rate.js's own sumAmountsByDate, which indexes
// already-summed-by-date AQL rows rather than a raw transaction list.
function sumAmountsByDate(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    totals.set(row.date, row.amountCents || 0);
  }
  return totals;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (typeof start !== 'string' || !DATE_PATTERN.test(start) || typeof end !== 'string' || !DATE_PATTERN.test(end)) {
      res.status(400).json({ error: 'start and end query parameters must be in YYYY-MM-DD format' });
      return;
    }

    if (start > end) {
      res.status(400).json({ error: 'start must be on or before end' });
      return;
    }

    const startDate = parseDateOnly(start);
    const endDate = parseDateOnly(end);

    if (inclusiveDayCount(startDate, endDate) > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `start and end must be at most ${MAX_RANGE_DAYS} days apart` });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    // Same baseFilter shape as spending-breakdown.js: transfer_id: null and
    // tombstone: false exclude transfers and deleted transactions from
    // spending totals, and category.group.is_income: false excludes income
    // (e.g. a paycheck deposit) the same way spending-breakdown.js excludes
    // income groups.
    const baseFilter = {
      date: { $gte: start, $lte: end },
      tombstone: false,
      transfer_id: null,
      'category.group.is_income': false,
    };

    const { data: rows } = await client.aqlQuery(
      q('transactions')
        .filter(baseFilter)
        .groupBy('date')
        .select([{ date: 'date' }, { amountCents: { $sum: '$amount' } }])
    );

    const totalsByDate = sumAmountsByDate(rows);

    const days = enumerateDays(startDate, endDate).map((date) => ({
      date,
      // Actual stores outflows (spending) as negative amounts internally
      // (same convention documented in spending-breakdown.js's
      // toPositiveSpendingCents), so the summed amountCents per day is
      // negated here, once, at this boundary.
      amountCents: -(totalsByDate.get(date) ?? 0),
    }));

    res.status(200).json({ days });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
