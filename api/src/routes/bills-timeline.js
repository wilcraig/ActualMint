const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');
const { assertTimezoneConfigured } = require('../month-days');
const { resolveScheduledAmount, expandOccurrences, parseDate } = require('../recurrence');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// Midnight of `date`'s own local calendar day (same stable-boundary pattern
// as month-end-projection.js / paycheck-alerts.js's identical helper).
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseMonth(month) {
  const [yearStr, monthStr] = month.split('-');
  return { year: Number(yearStr), month: Number(monthStr) };
}

function firstDayOfMonth(month) {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m - 1, 1);
}

// The LAST MOMENT of the last calendar day of `month`, not local midnight —
// recurrence.js generates recurring occurrences at local noon (byHourOfDay:
// [12]), so a midnight boundary would silently drop any recurring occurrence
// on the last day of the month (same fix as month-end-projection.js's
// monthEndDate() / paycheck-alerts.js's lastDayOfMonth()).
function lastDayOfMonth(month) {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m, 0, 23, 59, 59, 999);
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function payeesById(payees) {
  return new Map((payees || []).map((p) => [p.id, p]));
}

// `schedule.payee` absent/null, or pointing at a payee id that can't be
// resolved, both render the same generic label — there's nothing else to
// show either way.
function resolvePayeeName(schedule, payeesIndex) {
  if (!schedule.payee) return '(No payee)';
  const payee = payeesIndex.get(schedule.payee);
  return payee && payee.name ? payee.name : '(No payee)';
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    assertTimezoneConfigured();

    const today = startOfLocalDay(new Date());
    const monthEnd = lastDayOfMonth(month);
    // Clamp the range start to the later of "today" and the first day of the
    // requested month: for a future month, "today" is still in an earlier
    // month, and without this clamp the range would incorrectly span the
    // rest of the CURRENT month's remaining days too (same fix as
    // month-end-projection.js's rangeStart / final-review Fix 1). For the
    // current or a past month this is a no-op (today is already >= the
    // first of the month).
    const rangeStart = new Date(Math.max(today.getTime(), firstDayOfMonth(month).getTime()));

    // An entirely past month has nothing "upcoming" left in it — a
    // legitimate empty answer, not an error, so skip fetching data entirely.
    if (monthEnd < today) {
      res.status(200).json({ items: [] });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const [schedules, { data: payees }] = await Promise.all([
      client.getSchedules(),
      // Same AQL pattern spending-breakdown.js's payee lookup establishes:
      // fetch once, index by id, join in JS. Deliberately NOT
      // client.getAccountBalance() — this view trusts cc-helper's
      // already-written schedule amounts and must not risk disagreeing with
      // its closing-date/lag logic.
      client.aqlQuery(q('payees').select('*')),
    ]);

    const payeesIndex = payeesById(payees);

    const items = [];

    for (const schedule of schedules || []) {
      if (schedule.completed) continue;

      const payeeName = resolvePayeeName(schedule, payeesIndex);
      // Native Actual sign convention is kept as-is here (no negation) —
      // unlike the pacing/spending-breakdown views, this list intentionally
      // shows both bills (negative) and expected deposits (positive).
      const amountCents = resolveScheduledAmount(schedule.amount);

      if (typeof schedule.date === 'string') {
        // One-time schedule: a plain 'YYYY-MM-DD' string with its single
        // occurrence tracked separately in `next_date`. A non-completed
        // one-time schedule should normally have `next_date` set, but guard
        // against a malformed one (null/undefined) so it's skipped instead
        // of crashing the whole response (parseDate throws on nullish input).
        if (!schedule.next_date) continue;
        const nextDate = parseDate(schedule.next_date);
        if (nextDate >= rangeStart && nextDate <= monthEnd) {
          items.push({ scheduleId: schedule.id, payeeName, date: schedule.next_date, amountCents });
        }
      } else {
        // RecurConfig: one item per occurrence date in range.
        const occurrences = expandOccurrences(schedule.date, { start: rangeStart, end: monthEnd });
        for (const occurrence of occurrences) {
          items.push({ scheduleId: schedule.id, payeeName, date: formatDate(occurrence), amountCents });
        }
      }
    }

    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    res.status(200).json({ items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
