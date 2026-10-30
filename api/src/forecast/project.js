// Pure: turns a starting balance, an account's scheduled occurrences and a
// per-day allowance into a day-by-day balance series and the first breach of
// the warning level. Dates are 'YYYY-MM-DD' strings; math uses local Date
// parts (new Date(y, m-1, d+n) is DST-safe), never new Date('YYYY-MM-DD').
// Amounts are integer cents with Actual's sign (outflows negative).

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function projectAccount({ balanceCents, occurrences, allowancePerDayCents, warningLevelCents, today, windowDays }) {
  const [y, m, d] = today.split('-').map(Number);
  const dates = [];
  for (let i = 0; i <= windowDays; i++) dates.push(formatDate(new Date(y, m - 1, d + i)));

  const byDate = new Map(dates.map((date) => [date, []]));
  for (const o of occurrences) if (byDate.has(o.date)) byDate.get(o.date).push(o);

  const days = [];
  const events = [];
  let balance = balanceCents;
  let lowest = null;
  let breach = null;

  dates.forEach((date, i) => {
    const dayEvents = byDate.get(date);
    for (const e of dayEvents) {
      balance += e.amountCents;
      events.push({ date, name: e.name, amountCents: e.amountCents });
    }
    if (i > 0) balance -= allowancePerDayCents;
    days.push({ date, balanceCents: balance });

    if (lowest === null || balance < lowest.balanceCents) lowest = { date, balanceCents: balance };
    if (breach === null && balance < warningLevelCents) {
      let item = null;
      for (const e of dayEvents) {
        if (e.amountCents < 0 && (item === null || e.amountCents < item.amountCents)) {
          item = { name: e.name, amountCents: e.amountCents };
        }
      }
      breach = { date, balanceCents: balance, shortfallCents: warningLevelCents - balance, item };
    }
  });

  return { days, events, lowest, breach };
}

module.exports = { projectAccount };
