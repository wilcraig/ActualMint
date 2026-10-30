const { q } = require('@actual-app/api');

const { resolveScheduledAmount, expandOccurrences, parseDate } = require('./recurrence');

// Schedule occurrences in a date range, shared by /api/bills-timeline and
// the budget summary's Upcoming section so both list the same bills on the
// same days. Moved here unchanged from routes/bills-timeline.js.

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
// with an unresolvable rule or no category-setting action is a normal case,
// not an error, so this returns null rather than surfacing a failure.
function resolveCategoryId(schedule, rulesIndex) {
  const rule = rulesIndex.get(schedule.rule);
  if (!rule) return null;

  const action = (rule.actions || []).find((a) => a && a.op === 'set' && a.field === 'category');
  return action ? action.value : null;
}

// Everything occurrence-building needs, fetched in parallel.
async function loadScheduleData(client) {
  const [schedules, { data: payees }, rules, categoryGroups] = await Promise.all([
    client.getSchedules(),
    // Same AQL pattern spending-breakdown.js's payee lookup establishes:
    // fetch once, index by id, join in JS. Deliberately NOT
    // client.getAccountBalance() — this view trusts cc-helper's
    // already-written schedule amounts and must not risk disagreeing with
    // its closing-date/lag logic.
    client.aqlQuery(q('payees').select('*')),
    // A schedule's category lives in its rule's actions, not on the
    // schedule itself, so both rules and category-groups are fetched
    // alongside schedules/payees and joined in JS below.
    client.getRules(),
    client.getCategoryGroups(),
  ]);
  return { schedules, payees, rules, categoryGroups };
}

// One item per occurrence of each non-completed schedule falling in
// [rangeStart, rangeEnd], sorted by date. `rangeEnd` should be the last
// moment of its day: recurring occurrences are generated at local noon.
// Native Actual sign convention is kept as-is (bills negative, expected
// deposits positive).
function buildOccurrences({ schedules, payees, rules, categoryGroups }, rangeStart, rangeEnd) {
  const payeesIndex = payeesById(payees);
  const rulesIndex = rulesById(rules);
  const groupNameIndex = groupNameByCategoryId(categoryGroups);

  const items = [];

  for (const schedule of schedules || []) {
    if (schedule.completed) continue;

    const base = {
      scheduleId: schedule.id,
      scheduleName: schedule.name || null,
      payeeId: schedule.payee || null,
      payeeName: resolvePayeeName(schedule, payeesIndex),
      accountId: schedule.account || null,
      amountCents: resolveScheduledAmount(schedule.amount),
    };
    const categoryId = resolveCategoryId(schedule, rulesIndex);
    base.categoryId = categoryId;
    base.groupName = categoryId === null ? null : groupNameIndex.get(categoryId) ?? null;

    if (typeof schedule.date === 'string') {
      // One-time schedule: a plain 'YYYY-MM-DD' string with its single
      // occurrence tracked separately in `next_date`. A non-completed
      // one-time schedule should normally have `next_date` set, but guard
      // against a malformed one (null/undefined) so it's skipped instead
      // of crashing the whole response (parseDate throws on nullish input).
      if (!schedule.next_date) continue;
      const nextDate = parseDate(schedule.next_date);
      if (nextDate >= rangeStart && nextDate <= rangeEnd) {
        items.push({ ...base, date: schedule.next_date });
      }
    } else {
      // RecurConfig: one item per occurrence date in range.
      const occurrences = expandOccurrences(schedule.date, { start: rangeStart, end: rangeEnd });
      for (const occurrence of occurrences) {
        items.push({ ...base, date: formatDate(occurrence) });
      }
    }
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items;
}

// Occurrences from `fromDate` through the end of `toDate`'s day, with the
// account name resolved: { scheduleId, name, date, amountCents,
// accountName, ... } (amounts in Actual's sign convention).
async function upcomingOccurrences(client, fromDate, toDate) {
  const [data, accounts] = await Promise.all([loadScheduleData(client), client.getAccounts()]);
  const accountNames = new Map((accounts || []).map((a) => [a.id, a.name]));
  const rangeStart = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const rangeEnd = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
  return buildOccurrences(data, rangeStart, rangeEnd).map((item) => ({
    ...item,
    name: item.scheduleName || item.payeeName,
    accountName: accountNames.get(item.accountId) || '',
  }));
}

module.exports = { loadScheduleData, buildOccurrences, upcomingOccurrences };
