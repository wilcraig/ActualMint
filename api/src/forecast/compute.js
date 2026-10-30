const { q } = require('@actual-app/api');

const { forecastOccurrences, scheduledPayeeIdsByAccount } = require('./occurrences');
const { computeAllowance } = require('./allowance');
const { projectAccount } = require('./project');

// Gathers live data through the Actual client and runs the pure forecast
// modules for each enabled, eligible account. Read-only. Dates are local
// 'YYYY-MM-DD' strings built from date parts, never new Date('YYYY-MM-DD').

const HISTORY_WEEKS = 12;
const SYSTEM_PAYEE_NAMES = new Set(['starting balance', 'balance adjustment', 'reconciliation transaction']);

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysFrom(date, days) {
  return formatDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

// occurrences.js and scheduledPayeeIdsByAccount each load the schedule data;
// memoizing those reads makes the client hit them once per forecast.
function withSharedScheduleReads(client) {
  const cache = new Map();
  const once = (key, fn) => () => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  return Object.create(client, {
    getSchedules: { value: once('schedules', () => client.getSchedules()) },
    getRules: { value: once('rules', () => client.getRules()) },
    getCategoryGroups: { value: once('groups', () => client.getCategoryGroups()) },
    aqlQuery: { value: (query) => once('payees', () => client.aqlQuery(query))() },
  });
}

async function computeForecast({ client, now, settings }) {
  const shared = withSharedScheduleReads(client);
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = formatDate(todayDate);
  const windowDays = settings.windowDays;
  const historyStart = daysFrom(todayDate, -HISTORY_WEEKS * 7);
  const yesterday = daysFrom(todayDate, -1);

  const accounts = await shared.getAccounts();
  const eligible = (accounts || []).filter(
    (a) => !a.closed && !a.offbudget && settings.accounts[a.id] && settings.accounts[a.id].enabled
  );

  const result = { generatedAt: now.toISOString(), windowDays, today, results: [], errors: [] };
  if (eligible.length === 0) return result;

  const [occurrences, payeeIdsByAccount, payeeRows] = await Promise.all([
    forecastOccurrences(shared, { today, windowDays }),
    scheduledPayeeIdsByAccount(shared),
    shared.aqlQuery(q('payees').select('*')),
  ]);
  const systemPayeeIds = new Set(
    ((payeeRows && payeeRows.data) || [])
      .filter((p) => p.name && SYSTEM_PAYEE_NAMES.has(p.name.trim().toLowerCase()))
      .map((p) => p.id)
  );

  for (const account of eligible) {
    try {
      const { warningLevelCents } = settings.accounts[account.id];
      const balanceCents = await shared.getAccountBalance(account.id);
      const transactions = (await shared.getTransactions(account.id, historyStart, yesterday)) || [];
      const excludedPayeeIds = new Set([...systemPayeeIds, ...(payeeIdsByAccount.get(account.id) || [])]);
      const allowance = computeAllowance(transactions, { excludedPayeeIds, today });
      const projection = projectAccount({
        balanceCents,
        occurrences: occurrences.filter((o) => o.accountId === account.id),
        allowancePerDayCents: allowance.perDayCents,
        warningLevelCents,
        today,
        windowDays,
      });
      result.results.push({
        accountId: account.id,
        accountName: account.name,
        warningLevelCents,
        balanceCents,
        allowancePerDayCents: allowance.perDayCents,
        allowanceNote: allowance.note,
        ...projection,
      });
    } catch (err) {
      result.errors.push({ accountId: account.id, accountName: account.name, error: String((err && err.message) || err) });
    }
  }
  return result;
}

module.exports = { computeForecast };
