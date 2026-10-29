// daysElapsed/daysInMonth math below is day-of-month arithmetic on the
// server's own clock, which is only meaningful if the server's timezone
// matches the household's (the browser computes its `month` query param in
// its own local timezone). Nothing in this container sets TZ by default —
// a typical Docker base image defaults to UTC — so a missing TZ would
// otherwise silently compute wrong numbers (the day flips at UTC midnight
// instead of local midnight) rather than failing loudly. Checked once per
// request (not at module load) so this is both testable and robust to TZ
// being cleared/changed at runtime.
function assertTimezoneConfigured() {
  const tz = process.env.TZ;
  if (!tz || tz.trim().length === 0) {
    const err = new Error(
      'insights-api: process.env.TZ is not set. The insights-api container must set TZ to the ' +
        "household's timezone (e.g. TZ=America/Denver) so day-of-month math here matches the " +
        "browser's local time. Refusing to silently compute wrong daysElapsed/daysInMonth values."
    );
    err.statusCode = 500;
    throw err;
  }
}

function daysInMonthFor(year, month) {
  // Day 0 of the *next* month is the last day of `month` (1-indexed).
  return new Date(year, month, 0).getDate();
}

// How far "today" (the server's own clock) is into the requested month.
// Never derived from Actual's data — a past month reads as fully elapsed,
// a future month as not yet started.
function computeDays(month) {
  assertTimezoneConfigured();

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysInMonth = daysInMonthFor(year, monthNum);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let daysElapsed;
  if (year === currentYear && monthNum === currentMonth) {
    daysElapsed = now.getDate();
  } else if (year < currentYear || (year === currentYear && monthNum < currentMonth)) {
    daysElapsed = daysInMonth;
  } else {
    daysElapsed = 0;
  }

  return { daysElapsed, daysInMonth };
}

module.exports = { assertTimezoneConfigured, daysInMonthFor, computeDays };
