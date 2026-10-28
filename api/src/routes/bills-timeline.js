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

function rulesById(rules) {
  return new Map((rules || []).map((r) => [r.id, r]));
}

// Flattens getCategoryGroups()' nested shape into a categoryId -> groupName
// map, same fetch-once/index-by-id/join-in-JS pattern as payeesById above
// (and categories.js's own category flattening). Hidden groups/categories
// are NOT filtered out here (unlike categories.js/category-groups.js) —
// this is a best-effort label for an existing schedule, not a picker list,
// and a schedule tied to a hidden/since-renamed category should still show
// its group rather than silently go blank.
function groupNameByCategoryId(categoryGroups) {
  const map = new Map();
  for (const group of categoryGroups || []) {
    for (const category of group.categories || []) {
      map.set(category.id, group.name);
    }
  }
  return map;
}

// A schedule's category (when it has one) lives inside its rule's actions,
// not on the schedule object itself — client.getSchedules() has no category
// field at all. Resolves via schedule.rule -> rule.actions -> the one
// {op: 'set', field: 'category'} action, if any. Never throws: a schedule
// with an unresolvable rule, no category-setting action, or a categoryId
// that isn't in the current category-groups map (e.g. a hidden/deleted
// category) is a normal case, not an error — all of those just mean "no
// group to show," so this returns null rather than surfacing a failure.
function resolveGroupName(schedule, rulesIndex, groupNameIndex) {
  const rule = rulesIndex.get(schedule.rule);
  if (!rule) return null;

  const action = (rule.actions || []).find((a) => a && a.op === 'set' && a.field === 'category');
  if (!action) return null;

  return groupNameIndex.get(action.value) ?? null;
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

    const [schedules, { data: payees }, rules, categoryGroups] = await Promise.all([
      client.getSchedules(),
      // Same AQL pattern spending-breakdown.js's payee lookup establishes:
      // fetch once, index by id, join in JS. Deliberately NOT
      // client.getAccountBalance() — this view trusts cc-helper's
      // already-written schedule amounts and must not risk disagreeing with
      // its closing-date/lag logic.
      client.aqlQuery(q('payees').select('*')),
      // Additive groupName lookup (Plan 3e task 1): a schedule's category
      // lives in its rule's actions, not on the schedule itself, so both
      // rules and category-groups are fetched alongside schedules/payees
      // and joined in JS below, same Promise.all parallelization as above.
      client.getRules(),
      client.getCategoryGroups(),
    ]);

    const payeesIndex = payeesById(payees);
    const rulesIndex = rulesById(rules);
    const groupNameIndex = groupNameByCategoryId(categoryGroups);

    const items = [];

    for (const schedule of schedules || []) {
      if (schedule.completed) continue;

      const payeeName = resolvePayeeName(schedule, payeesIndex);
      // Native Actual sign convention is kept as-is here (no negation) —
      // unlike the pacing/spending-breakdown views, this list intentionally
      // shows both bills (negative) and expected deposits (positive).
      const amountCents = resolveScheduledAmount(schedule.amount);
      const groupName = resolveGroupName(schedule, rulesIndex, groupNameIndex);

      if (typeof schedule.date === 'string') {
        // One-time schedule: a plain 'YYYY-MM-DD' string with its single
        // occurrence tracked separately in `next_date`. A non-completed
        // one-time schedule should normally have `next_date` set, but guard
        // against a malformed one (null/undefined) so it's skipped instead
        // of crashing the whole response (parseDate throws on nullish input).
        if (!schedule.next_date) continue;
        const nextDate = parseDate(schedule.next_date);
        if (nextDate >= rangeStart && nextDate <= monthEnd) {
          items.push({ scheduleId: schedule.id, payeeName, date: schedule.next_date, amountCents, groupName });
        }
      } else {
        // RecurConfig: one item per occurrence date in range.
        const occurrences = expandOccurrences(schedule.date, { start: rangeStart, end: monthEnd });
        for (const occurrence of occurrences) {
          items.push({ scheduleId: schedule.id, payeeName, date: formatDate(occurrence), amountCents, groupName });
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
