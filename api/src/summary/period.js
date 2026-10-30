// Turns a delivery's period kind into the date range its activity sections
// cover. All math is on local calendar days in the process TZ (the server's
// household time zone, see month-days.js), never on UTC timestamps.

const PERIOD_KINDS = ['yesterday', 'week', 'since-last', 'month-to-date'];

function formatDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Local midnight `days` days from `date` (negative goes back). Built from
// y/m/d rather than adding milliseconds, so DST changes never shift the day.
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// { kind, start, end, highlightStart? } with 'YYYY-MM-DD' bounds, inclusive.
// - yesterday: the day before `now`.
// - week: the 7 days ending yesterday.
// - since-last: the day of `lastSentAt` through yesterday. This is only a
//   lookback window; the Largest transactions section decides what is new
//   by transaction id. No previous send means the same range as `week`.
// - month-to-date: the 1st through yesterday (through today on the 1st, so
//   the range is never empty), highlighting the last 7 days of the range.
function resolvePeriod(kind, now, lastSentAt = null) {
  const yesterday = addDays(now, -1);
  const weekStart = addDays(now, -7);

  switch (kind) {
    case 'yesterday':
      return { kind, start: formatDay(yesterday), end: formatDay(yesterday) };
    case 'week':
      return { kind, start: formatDay(weekStart), end: formatDay(yesterday) };
    case 'since-last': {
      if (!lastSentAt) return { kind, start: formatDay(weekStart), end: formatDay(yesterday) };
      const start = formatDay(lastSentAt);
      const end = formatDay(yesterday);
      // A send earlier today would put start after end; keep the range valid.
      return { kind, start: start > end ? end : start, end };
    }
    case 'month-to-date': {
      const end = now.getDate() === 1 ? new Date(now.getFullYear(), now.getMonth(), 1) : yesterday;
      return {
        kind,
        start: formatDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: formatDay(end),
        highlightStart: formatDay(addDays(end, -6)),
      };
    }
    default:
      throw new Error(`unknown period kind: ${kind}`);
  }
}

module.exports = { resolvePeriod, formatDay, addDays, PERIOD_KINDS };
