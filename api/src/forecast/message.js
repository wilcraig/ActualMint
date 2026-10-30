// The low-balance warning as the message every channel receives:
// { title, text, markdown, html, data }, the same shape as a budget summary.
// It states what the forecast found and gives no advice.

const { formatMoney } = require('../summary/format');
const { escapeHtml } = require('../summary/formatters');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2026-11-13' -> 'Nov 13'
function shortDate(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

// The lines under one account's name.
function accountLines(w) {
  const { breach, lowest } = w;
  const cause = breach.item
    ? `${breach.item.name} (${formatMoney(-breach.item.amountCents)})`
    : 'everyday spending';
  return [
    `Goes below ${formatMoney(w.warningLevelCents)} on ${shortDate(breach.date)}, caused by ${cause}.`,
    `${formatMoney(breach.shortfallCents)} below that level.`,
    `Lowest balance: ${formatMoney(lowest.balanceCents)} on ${shortDate(lowest.date)}.`,
    w.allowancePerDayCents > 0
      ? `Includes an allowance of about ${formatMoney(w.allowancePerDayCents)} a day for everyday spending.`
      : w.allowanceNote,
  ];
}

function toText(warnings) {
  return warnings
    .map((w) => [w.accountName, ...accountLines(w).map((line) => `- ${line}`)].join('\n'))
    .join('\n\n');
}

function toMarkdown(title, warnings) {
  const parts = [`**${title}**`];
  for (const w of warnings) {
    parts.push([`**${w.accountName}**`, ...accountLines(w).map((line) => `- ${line}`)].join('\n'));
  }
  return parts.join('\n\n');
}

function toHtml(title, warnings) {
  const parts = [`<h2>${escapeHtml(title)}</h2>`];
  for (const w of warnings) {
    parts.push(`<h3>${escapeHtml(w.accountName)}</h3>`);
    parts.push(`<ul>${accountLines(w).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
  }
  return `<div>${parts.join('\n')}</div>`;
}

// Webhook payload, schema version 1: keys and meanings only ever grow;
// amounts are integer cents, dates 'YYYY-MM-DD'.
function toPayload(warnings, windowDays, generatedAt) {
  return {
    schemaVersion: 1,
    event: 'cash-flow-warning',
    generatedAt,
    windowDays,
    accounts: warnings.map((w) => ({
      accountId: w.accountId,
      accountName: w.accountName,
      warningLevelCents: w.warningLevelCents,
      firstDate: w.breach.date,
      shortfallCents: w.breach.shortfallCents,
      lowestCents: w.lowest.balanceCents,
      lowestDate: w.lowest.date,
      item: w.breach.item,
      allowancePerDayCents: w.allowancePerDayCents,
    })),
  };
}

function buildWarningMessage({ warnings, windowDays, generatedAt }) {
  const title = `Low balance warning: ${warnings.map((w) => w.accountName).join(', ')}`;
  return {
    title,
    text: toText(warnings),
    markdown: toMarkdown(title, warnings),
    html: toHtml(title, warnings),
    data: toPayload(warnings, windowDays, generatedAt),
  };
}

// For "Send test message": the same shape, clearly not a real warning.
function buildTestMessage() {
  const title = 'Cash-flow check test';
  const text = 'This is a test message from the cash-flow check. No balance is low.';
  return {
    title,
    text,
    markdown: `**${title}**\n\n${text}`,
    html: `<div><h2>${escapeHtml(title)}</h2>\n<p>${escapeHtml(text)}</p></div>`,
    data: { schemaVersion: 1, event: 'cash-flow-test' },
  };
}

module.exports = { buildWarningMessage, buildTestMessage };
