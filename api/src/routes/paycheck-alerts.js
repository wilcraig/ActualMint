const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { assertTimezoneConfigured } = require('../month-days');
const { resolveScheduledAmount, expandOccurrences } = require('../recurrence');

// Midnight of `date`'s own local calendar day (see month-end-projection.js's
// identical helper for why: a stable boundary that doesn't shift behavior
// depending on what time of day a request happens to arrive).
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthToStr(year, month) {
  // Normalize `month` (1-indexed, but may be <1 or >12 from month arithmetic)
  // back into a real 1-12 month plus a carried/borrowed year.
  let y = year;
  let m = month;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function parseMonth(month) {
  const [yearStr, monthStr] = month.split('-');
  return { year: Number(yearStr), month: Number(monthStr) };
}

// Shifts `month` (a 'YYYY-MM' string) by `delta` calendar months, correctly
// rolling the year over in either direction (e.g. December + 1 -> next
// January; January - 1 -> previous December).
function addMonths(month, delta) {
  const { year, month: m } = parseMonth(month);
  return monthToStr(year, m + delta);
}

function firstDayOfMonth(month) {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m - 1, 1);
}

// The LAST MOMENT of the last calendar day of `month`, not local midnight.
// recurrence.js generates recurring occurrences at local noon
// (byHourOfDay: [12]), so a midnight boundary would silently drop any
// recurring occurrence on the last day of the month (same fix as
// month-end-projection.js's monthEndDate()).
function lastDayOfMonth(month) {
  const { year, month: m } = parseMonth(month);
  return new Date(year, m, 0, 23, 59, 59, 999);
}

// Builds the set of payee ids that represent transfers between the
// household's own accounts, same pattern as month-end-projection.js: Actual
// always writes a transfer's own-account leg with a positive amount
// regardless of direction, so without this exclusion a transfer schedule
// (e.g. a checking->card autopay) would be misclassified as income.
function transferPayeeIds(payees) {
  return new Set((payees || []).filter((p) => p.transfer_acct).map((p) => p.id));
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    // Called once per request, not once per schedule-iteration below (14
    // month-boundary computations happen per qualifying schedule).
    assertTimezoneConfigured();

    const client = await getActualClient();
    await syncIfDue(client);

    const [schedules, payees] = await Promise.all([client.getSchedules(), client.getPayees()]);
    const transferIds = transferPayeeIds(payees);

    const today = startOfLocalDay(new Date());
    const currentMonth = monthToStr(today.getFullYear(), today.getMonth() + 1);
    const nextMonth = addMonths(currentMonth, 1);

    const alerts = [];

    for (const schedule of schedules || []) {
      if (schedule.completed) continue;
      // A one-time schedule's `date` is a plain 'YYYY-MM-DD' string; only a
      // RecurConfig (an object) has a meaningful cadence to compare against.
      if (typeof schedule.date === 'string') continue;

      const amountPerOccurrenceCents = resolveScheduledAmount(schedule.amount);
      if (amountPerOccurrenceCents <= 0) continue;

      if (transferIds.has(schedule.payee)) continue;

      for (const month of [currentMonth, nextMonth]) {
        const occurrencesThisMonth = expandOccurrences(schedule.date, {
          start: firstDayOfMonth(month),
          end: lastDayOfMonth(month),
        }).length;

        // Trailing 12-calendar-month window ending at (and including) `month`.
        const yearWindow = {
          start: firstDayOfMonth(addMonths(month, -11)),
          end: lastDayOfMonth(month),
        };
        const occurrencesInYear = expandOccurrences(schedule.date, yearWindow).length;
        const averagePerMonth = occurrencesInYear / 12;

        if (occurrencesThisMonth > averagePerMonth) {
          alerts.push({
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            month,
            occurrences: occurrencesThisMonth,
            averagePerMonth,
            amountPerOccurrenceCents,
          });
        }
      }
    }

    res.status(200).json({ alerts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
