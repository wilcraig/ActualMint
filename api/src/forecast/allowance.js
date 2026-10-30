// Pure: estimates everyday spending per day from recent transactions. Weeks
// are the 7-day blocks ending yesterday (week 0), the week before (week 1),
// and so on, up to 8. The median weekly spend keeps one-off big purchases from
// inflating the allowance. Dates are 'YYYY-MM-DD' strings; math uses local
// Date parts, never new Date('YYYY-MM-DD') (that parses as UTC).
const MAX_WEEKS = 8;
const MIN_WEEKS = 4;
const NOTE = 'Not enough history for an everyday-spending allowance (needs 4 weeks).';

// Whole days from date string a back to date string b (b later). Uses UTC
// midnights of the parts so DST shifts cannot skew the count.
function dayNumber(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function computeAllowance(transactions, { excludedPayeeIds, today }) {
  const todayN = dayNumber(today);
  let earliest = null;
  for (const t of transactions) {
    const n = dayNumber(t.date);
    if (earliest === null || n < earliest) earliest = n;
  }
  const historyDays = earliest === null ? 0 : todayN - earliest;
  const weeksUsed = Math.min(MAX_WEEKS, Math.floor(historyDays / 7));
  if (weeksUsed < MIN_WEEKS) return { perDayCents: 0, weeksUsed, note: NOTE };

  const weekly = new Array(weeksUsed).fill(0);
  for (const t of transactions) {
    if (t.amount >= 0 || t.transfer_id || excludedPayeeIds.has(t.payee)) continue;
    const ago = todayN - dayNumber(t.date);
    if (ago < 1) continue;
    const week = Math.floor((ago - 1) / 7);
    if (week < weeksUsed) weekly[week] += -t.amount;
  }

  weekly.sort((a, b) => a - b);
  const mid = weeksUsed >> 1;
  const median = weeksUsed % 2 ? weekly[mid] : (weekly[mid - 1] + weekly[mid]) / 2;
  return { perDayCents: Math.round(median / 7), weeksUsed, note: null };
}

module.exports = { computeAllowance };
