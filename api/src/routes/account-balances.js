const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');

const RANGE_PATTERN = /^(1M|3M|6M|1Y|all)$/;

// A floor date safely before any real bank data. Querying from here (rather
// than from rangeStart) is what lets a single getTransactions call also
// yield the correct starting balance for the display range: every
// transaction between this floor and rangeStart gets folded into day one's
// cumulative balance instead of being invisible.
const FLOOR_DATE = '1900-01-01';

// Midnight of `date`'s own local calendar day (same stable-boundary pattern
// as month-end-projection.js's startOfLocalDay / accounts.js).
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateOnly(dateStr) {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// today minus N months, landing on the same day-of-month (JS Date's own
// month-overflow rollback behavior, e.g. "2026-01-31 minus 1 month" clamping
// is intentionally delegated to the platform rather than re-implemented).
function monthsBefore(date, months) {
  return new Date(date.getFullYear(), date.getMonth() - months, date.getDate());
}

function yearsBefore(date, years) {
  return new Date(date.getFullYear() - years, date.getMonth(), date.getDate());
}

// Every calendar day from `start` to `end`, inclusive, as YYYY-MM-DD strings.
function enumerateDays(start, end) {
  const days = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    days.push(formatDate(cursor));
  }
  return days;
}

// Buckets a flat transaction list into { dateStr: totalAmountCents }, summing
// same-day transactions together. Grouping (rather than relying on
// getTransactions's own ordering, which `api/transactions-get`'s handler
// does not sort — confirmed by reading
// node_modules/@actual-app/api/dist/index.js) means the per-day totals this
// route computes never depend on what order the API happens to return rows
// in; the dates are re-sorted explicitly below.
function sumAmountsByDate(transactions) {
  const totals = new Map();
  for (const txn of transactions || []) {
    const prior = totals.get(txn.date) || 0;
    totals.set(txn.date, prior + (txn.amount || 0));
  }
  return totals;
}

// Builds the daily balance series for one account's transactions across
// `days` (every calendar day from rangeStart to rangeEnd, inclusive).
// Transactions dated before rangeStart (back to the FLOOR_DATE query) are
// folded into the running balance before the first day is emitted, so day
// one already reflects the correct cumulative starting balance rather than
// starting from zero. A day with no transactions carries the previous day's
// balance forward.
function buildDailySeries(transactions, days, rangeStartStr) {
  const totalsByDate = sumAmountsByDate(transactions);
  const sortedDates = [...totalsByDate.keys()].sort();

  let runningBalance = 0;
  let cursor = 0;

  // Fold in everything strictly before rangeStart.
  while (cursor < sortedDates.length && sortedDates[cursor] < rangeStartStr) {
    runningBalance += totalsByDate.get(sortedDates[cursor]);
    cursor += 1;
  }

  const points = [];
  for (const day of days) {
    while (cursor < sortedDates.length && sortedDates[cursor] <= day) {
      runningBalance += totalsByDate.get(sortedDates[cursor]);
      cursor += 1;
    }
    points.push({ date: day, balanceCents: runningBalance });
  }

  return points;
}

function earliestTransactionDate(transactionsByAccount) {
  let earliest = null;
  for (const transactions of transactionsByAccount) {
    for (const txn of transactions) {
      if (earliest === null || txn.date < earliest) {
        earliest = txn.date;
      }
    }
  }
  return earliest;
}

function computeRangeStart(range, rangeEnd, transactionsByAccount) {
  if (range === '1M') return monthsBefore(rangeEnd, 1);
  if (range === '3M') return monthsBefore(rangeEnd, 3);
  if (range === '6M') return monthsBefore(rangeEnd, 6);
  if (range === '1Y') return yearsBefore(rangeEnd, 1);

  // range === 'all'
  const earliest = earliestTransactionDate(transactionsByAccount);
  return earliest ? parseDateOnly(earliest) : rangeEnd;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { range } = req.query;

    if (typeof range !== 'string' || !RANGE_PATTERN.test(range)) {
      res.status(400).json({ error: 'range query parameter must be one of 1M, 3M, 6M, 1Y, all' });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const rangeEnd = startOfLocalDay(new Date());
    const rangeEndStr = formatDate(rangeEnd);

    const allAccounts = await client.getAccounts();
    const openAccounts = (allAccounts || []).filter((account) => !account.closed);

    // `range=all` needs every account's transactions up front to find the
    // earliest date, so fetch for all open accounts before resolving
    // rangeStart (every other range only needs "today", computed above).
    const transactionsByAccountId = new Map();
    await Promise.all(
      openAccounts.map(async (account) => {
        const transactions = await client.getTransactions(account.id, FLOOR_DATE, rangeEndStr);
        transactionsByAccountId.set(account.id, transactions || []);
      })
    );

    const rangeStart = computeRangeStart(range, rangeEnd, transactionsByAccountId.values());
    const rangeStartStr = formatDate(rangeStart);
    const days = enumerateDays(rangeStart, rangeEnd);

    const accounts = openAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      points: buildDailySeries(transactionsByAccountId.get(account.id), days, rangeStartStr),
    }));

    const netWorth = days.map((day, index) => ({
      date: day,
      balanceCents: accounts.reduce((sum, account) => sum + account.points[index].balanceCents, 0),
    }));

    res.status(200).json({
      range,
      rangeStart: rangeStartStr,
      rangeEnd: rangeEndStr,
      accounts,
      netWorth,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
