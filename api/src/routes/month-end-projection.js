const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { computeDays } = require('../month-days');
const { resolveScheduledAmount, expandOccurrences } = require('../recurrence');

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// A one-time schedule's `next_date` is a plain 'YYYY-MM-DD' string. Native
// `new Date('YYYY-MM-DD')` parses that as UTC midnight, not local midnight —
// in a negative-UTC-offset household timezone that silently shifts the date
// back a calendar day (the same pitfall recurrence.js's own parseDate works
// around). Parse it the same way here so this stays TZ-safe end to end.
function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function monthEndDate(month) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  // Last day of `month` at local midnight; day 0 of the next month.
  return new Date(year, monthNum, 0);
}

// Builds the set of payee ids that represent transfers between the
// household's own accounts (e.g. a checking account paying off a credit
// card). Actual always writes a transfer's own-account leg with a positive
// amount regardless of direction, so without this exclusion a transfer
// schedule like cc-helper's checking->card autopay would be misclassified
// as income.
function transferPayeeIds(payees) {
  return new Set((payees || []).filter((p) => p.transfer_acct).map((p) => p.id));
}

// Sums the scheduled income expected between `today` and `monthEnd`
// (inclusive), excluding completed schedules, non-positive amounts, and
// transfers to/from the household's own accounts.
function sumRemainingScheduledIncome(schedules, transferIds, today, monthEnd) {
  let total = 0;

  for (const schedule of schedules || []) {
    if (schedule.completed) continue;

    const amount = resolveScheduledAmount(schedule.amount);
    if (amount <= 0) continue;

    if (transferIds.has(schedule.payee)) continue;

    if (typeof schedule.date === 'string') {
      // One-time schedule: count it once if its next occurrence falls in range.
      const nextDate = parseLocalDate(schedule.next_date);
      if (nextDate >= today && nextDate <= monthEnd) {
        total += amount;
      }
    } else {
      const occurrences = expandOccurrences(schedule.date, { start: today, end: monthEnd });
      total += occurrences.length * amount;
    }
  }

  return total;
}

// Projects each non-income category's spending to month end using its
// current daily run rate, capping an at/under-budget category's projection
// at its budgeted amount (an already-over-budget category keeps trending
// uncapped).
function sumTrendedRemainingSpending(categoryGroups, daysElapsed, daysInMonth) {
  if (daysElapsed === 0) return 0;

  const remainingDays = daysInMonth - daysElapsed;
  let total = 0;

  for (const group of categoryGroups || []) {
    if (group.is_income) continue;

    for (const category of group.categories || []) {
      const spent = -(category.spent ?? 0);
      const budgeted = category.budgeted ?? 0;

      const dailyRate = spent / daysElapsed;
      let projectedTotal = spent + dailyRate * remainingDays;
      if (spent <= budgeted) {
        projectedTotal = Math.min(projectedTotal, budgeted);
      }

      total += Math.max(0, projectedTotal - spent);
    }
  }

  return total;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { month } = req.query;

    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
      res.status(400).json({ error: 'month query parameter must be in YYYY-MM format' });
      return;
    }

    const client = await getActualClient();
    await syncIfDue(client);

    const { daysElapsed, daysInMonth } = computeDays(month);

    const [budgetMonth, schedules, payees] = await Promise.all([
      client.getBudgetMonth(month),
      client.getSchedules(),
      client.getPayees(),
    ]);

    const incomeSoFarCents = budgetMonth.totalIncome ?? 0;
    const spentSoFarCents = -(budgetMonth.totalSpent ?? 0);

    const today = new Date();
    const monthEnd = monthEndDate(month);
    const transferIds = transferPayeeIds(payees);
    const remainingScheduledIncomeCents = sumRemainingScheduledIncome(schedules, transferIds, today, monthEnd);

    const trendedRemainingSpendingCents = sumTrendedRemainingSpending(budgetMonth.categoryGroups, daysElapsed, daysInMonth);

    const projectedNetCents =
      incomeSoFarCents + remainingScheduledIncomeCents - spentSoFarCents - trendedRemainingSpendingCents;

    res.status(200).json({
      month,
      projectedNetCents,
      components: {
        incomeSoFarCents,
        remainingScheduledIncomeCents,
        spentSoFarCents,
        trendedRemainingSpendingCents,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
