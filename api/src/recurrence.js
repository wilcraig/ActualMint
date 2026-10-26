// Schedule recurrence expansion, built on the same `@rschedule` library Actual's own
// server uses for this (not reimplementing RRULE math from scratch).
//
// Sources confirmed in api/node_modules/@actual-app/core:
// - RecurConfig -> rschedule rule options conversion: ported from `recurConfigToRSchedule`
//   in src/shared/schedules.ts:201-253 (not exported from the public @actual-app/api package).
// - Weekend-skip shifting: ported from `getDateWithSkippedWeekend` in
//   src/shared/schedules.ts:340-354.
// - Amount resolution: ported from `getScheduledAmount` in src/shared/schedules.ts:356-369
//   (without the `inverse` parameter, which this project doesn't need).
// - Schedule construction/query pattern: src/server/schedules/app.ts:474-486 and
//   src/server/schedules/find-schedules.ts:15-21.
//
// `occurrences({ start, end })` (a date-range query, as opposed to the `{ take: N }` form
// used in those call sites) is confirmed supported by the installed @rschedule/core's type
// declarations: see IOccurrencesArgs in
// api/node_modules/@rschedule/core/generators/occurrence-generator.d.ts.

require('@rschedule/standard-date-adapter/setup');
const { Schedule: RSchedule } = require('@rschedule/core/generators');
const { isWeekend, previousFriday, nextMonday } = require('date-fns');

function parseDate(dateString) {
  // RecurConfig dates are plain 'YYYY-MM-DD' strings; parse as local-midnight
  // the same way monthUtils.parseDate does, avoiding UTC-vs-local offset bugs.
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function abbrevDay(name) {
  return name.slice(0, 2).toUpperCase();
}

// Mirrors recurConfigToRSchedule (api/node_modules/@actual-app/core/src/shared/schedules.ts:201-253):
// converts a RecurConfig into one or more rschedule rule-options objects.
function recurConfigToRules(config) {
  const base = {
    start: parseDate(config.start),
    frequency: config.frequency.toUpperCase(),
    byHourOfDay: [12],
  };

  if (config.interval) {
    base.interval = config.interval;
  }

  switch (config.endMode) {
    case 'after_n_occurrences':
      base.count = config.endOccurrences;
      break;
    case 'on_date':
      base.end = parseDate(config.endDate);
      break;
    default:
      break;
  }

  switch (config.frequency) {
    case 'daily':
    case 'weekly':
    case 'yearly':
      return [base];
    case 'monthly':
      if (config.patterns && config.patterns.length > 0) {
        const days = config.patterns.filter((p) => p.type === 'day');
        const dayNames = config.patterns.filter((p) => p.type !== 'day');

        return [
          days.length > 0 && { ...base, byDayOfMonth: days.map((p) => p.value) },
          dayNames.length > 0 && {
            ...base,
            byDayOfWeek: dayNames.map((p) => [abbrevDay(p.type), p.value]),
          },
        ].filter(Boolean);
      }
      return [base];
    default:
      throw new Error('Invalid recurring date config');
  }
}

// Mirrors getDateWithSkippedWeekend (api/node_modules/@actual-app/core/src/shared/schedules.ts:340-354).
function getDateWithSkippedWeekend(date, solveMode) {
  if (isWeekend(date)) {
    if (solveMode === 'after') {
      return nextMonday(date);
    }
    if (solveMode === 'before') {
      return previousFriday(date);
    }
    throw new Error('Unknown weekend solve mode, this should not happen!');
  }
  return date;
}

// Mirrors getScheduledAmount (api/node_modules/@actual-app/core/src/shared/schedules.ts:356-369),
// without its `inverse` parameter.
function resolveScheduledAmount(amount) {
  if (amount == null) return 0;
  if (typeof amount === 'number') {
    return amount;
  }
  return Math.round((amount.num1 + amount.num2) / 2);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Expands a RecurConfig into the occurrence dates falling within [range.start, range.end]
// (inclusive). Never throws for a schedule that's exhausted or not yet started; returns [].
function expandOccurrences(config, range) {
  const rules = recurConfigToRules(config);
  const schedule = new RSchedule({ rrules: rules });

  if (!config.skipWeekend) {
    return schedule
      .occurrences({ start: range.start, end: range.end })
      .toArray()
      .map((occ) => occ.date);
  }

  // When a schedule skips weekends, its *post-shift* date is what should be
  // compared against [range.start, range.end] - not the natural, unshifted
  // occurrence date @rschedule generates. An occurrence whose natural date is
  // just outside the requested range can shift into it (e.g. a 'before' shift
  // from the 1st of next month back to the last Friday of this month), and
  // vice versa (final-review Fix 3). So query a padded window from the
  // underlying generator, apply the weekend shift to each occurrence, and
  // only then filter down to the actually-requested range. A weekend shift
  // never moves a date more than 2 days (Sat->Fri or Sun->Mon), so a 3-day
  // pad on each side is generous headroom.
  const paddedStart = addDays(range.start, -3);
  const paddedEnd = addDays(range.end, 3);

  const occurrences = schedule
    .occurrences({ start: paddedStart, end: paddedEnd })
    .toArray()
    .map((occ) => occ.date);

  const shifted = occurrences.map((date) => getDateWithSkippedWeekend(date, config.weekendSolveMode));

  return shifted.filter((date) => date >= range.start && date <= range.end);
}

module.exports = { resolveScheduledAmount, expandOccurrences, parseDate };
