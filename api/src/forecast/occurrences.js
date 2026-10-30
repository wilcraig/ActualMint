const { loadScheduleData, buildOccurrences } = require('../bills-data');
const { resolveScheduledAmount, parseDate } = require('../recurrence');

// Scheduled bills and paychecks for the forecast window, for all accounts
// (callers filter by accountId). `today` is a 'YYYY-MM-DD' string; dates are
// built from local parts, never new Date('YYYY-MM-DD') (that parses as UTC).

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function forecastOccurrences(client, { today, windowDays }) {
  const data = await loadScheduleData(client);
  const start = parseDate(today);
  const rangeStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // Last moment of the end day: recurring occurrences are generated at noon.
  const rangeEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + windowDays, 23, 59, 59, 999);
  const todayStr = formatDate(rangeStart);

  const nextDates = new Map();
  for (const s of data.schedules || []) if (s.next_date) nextDates.set(s.id, s.next_date);

  const items = [];

  // A schedule whose next occurrence is already past is overdue: it has not
  // posted, so it still hits the balance, shown as a single item on today.
  const payeeNames = new Map((data.payees || []).map((p) => [p.id, p.name]));
  for (const s of data.schedules || []) {
    if (s.completed || !s.next_date || s.next_date >= todayStr) continue;
    items.push({
      scheduleId: s.id,
      name: s.name || (s.payee && payeeNames.get(s.payee)) || '(No payee)',
      payeeId: s.payee || null,
      accountId: s.account || null,
      date: todayStr,
      amountCents: resolveScheduledAmount(s.amount),
      overdue: true,
    });
  }

  for (const item of buildOccurrences(data, rangeStart, rangeEnd)) {
    // Before next_date means already posted; today's balance includes it.
    const next = nextDates.get(item.scheduleId);
    if (next && item.date < next) continue;
    items.push({
      scheduleId: item.scheduleId,
      name: item.scheduleName || item.payeeName,
      payeeId: item.payeeId,
      accountId: item.accountId,
      date: item.date,
      amountCents: item.amountCents,
      overdue: false,
    });
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items;
}

// Payees of active schedules per account, so the everyday-spending allowance
// can skip spending the schedules already cover.
async function scheduledPayeeIdsByAccount(client) {
  const { schedules } = await loadScheduleData(client);
  const map = new Map();
  for (const s of schedules || []) {
    if (s.completed || !s.account || !s.payee) continue;
    if (!map.has(s.account)) map.set(s.account, new Set());
    map.get(s.account).add(s.payee);
  }
  return map;
}

module.exports = { forecastOccurrences, scheduledPayeeIdsByAccount };
