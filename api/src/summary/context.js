const { isIncomeGroup, isTransferGroup } = require('../cash-flow-data');
const { daysInMonthFor } = require('../month-days');
const { formatDay } = require('./period');

// Everything a section needs to build itself: the Actual client, the
// current month (pacing always measures the month the summary is sent in),
// the delivery's period (activity sections), the shared settings, and the
// counting rules the charts use. Income groups, the Transfers group and
// excluded categories are never counted as spending; the Sankey's
// drop-refund-categories rule deliberately does not apply here.
async function buildContext({ client, now, period, settings, delivery, reportedIds = new Set() }) {
  const year = now.getFullYear();
  const monthNum = now.getMonth() + 1;
  const daysInMonth = daysInMonthFor(year, monthNum);
  const month = formatDay(now).slice(0, 7);

  const excludedCategories = new Set(settings.exclusions.categoryIds);
  const excludedPayees = new Set(settings.exclusions.payeeIds);
  const excludedSchedules = new Set(settings.exclusions.scheduleIds);

  const categories = new Map();
  for (const group of (await client.getCategoryGroups()) || []) {
    const isIncome = Boolean(isIncomeGroup(group));
    const isTransfer = isTransferGroup(group);
    for (const category of group.categories || []) {
      categories.set(category.id, {
        id: category.id,
        name: category.name,
        groupName: group.name,
        groupId: group.id,
        isIncome,
        isTransfer,
        excluded: excludedCategories.has(category.id),
      });
    }
  }

  return {
    client,
    now,
    month,
    monthStart: `${month}-01`,
    monthEnd: `${month}-${String(daysInMonth).padStart(2, '0')}`,
    // Counts today, so the 1st is day 1 and pacing never divides by zero.
    daysElapsed: now.getDate(),
    daysInMonth,
    period,
    settings,
    delivery,
    reportedIds,
    categories,
    isCountedCategory(id) {
      const category = categories.get(id);
      return Boolean(category) && !category.isIncome && !category.isTransfer && !category.excluded;
    },
    isExcludedPayee: (id) => excludedPayees.has(id),
    isExcludedSchedule: (id) => excludedSchedules.has(id),
  };
}

module.exports = { buildContext };
