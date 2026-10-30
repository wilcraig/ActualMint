// Turns one built summary into the message every channel receives:
// { title, text, markdown, html, data }. Channels use what fits (ntfy and
// Telegram the text, Discord and Slack the markdown, email the HTML,
// webhooks and Home Assistant the data).

const PERIOD_LABELS = {
  yesterday: 'Yesterday',
  week: 'Week in Review',
  'since-last': 'New Since Last Summary',
  'month-to-date': 'Month-to-date, highlighting This Week',
};

const NOTHING = 'Nothing to report.';
const FAILED_LINE = 'This section could not be built.';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// [{ title, lines }] in summary order; a failed section gets one line saying so.
function blocks(summary) {
  return Object.values(summary.sections).map((section) => ({
    title: section.title,
    lines: section.error ? [FAILED_LINE] : section.lines || [],
  }));
}

function periodLine(summary) {
  const label = PERIOD_LABELS[summary.delivery.period] || summary.delivery.period;
  const { start, end } = summary.period;
  return `${label}: ${start === end ? start : `${start} to ${end}`}`;
}

function toText(summary) {
  const parts = [periodLine(summary)];
  const sections = blocks(summary);
  if (sections.length === 0) parts.push(NOTHING);
  for (const { title, lines } of sections) {
    parts.push([title, ...lines.map((line) => `- ${line}`)].join('\n'));
  }
  return parts.join('\n\n');
}

function toMarkdown(title, summary) {
  const parts = [`**${title}**`, `_${periodLine(summary)}_`];
  const sections = blocks(summary);
  if (sections.length === 0) parts.push(NOTHING);
  for (const { title: sectionTitle, lines } of sections) {
    parts.push([`**${sectionTitle}**`, ...lines.map((line) => `- ${line}`)].join('\n'));
  }
  return parts.join('\n\n');
}

// Plain, self-contained HTML for email: no scripts, style sheets, images
// or links, and every value escaped.
function toHtml(title, summary) {
  const parts = [`<h2>${escapeHtml(title)}</h2>`, `<p>${escapeHtml(periodLine(summary))}</p>`];
  const sections = blocks(summary);
  if (sections.length === 0) parts.push(`<p>${NOTHING}</p>`);
  for (const { title: sectionTitle, lines } of sections) {
    parts.push(`<h3>${escapeHtml(sectionTitle)}</h3>`);
    parts.push(`<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
  }
  return `<div>${parts.join('\n')}</div>`;
}

// The webhook payload, schema version 1. Agents parse this, so keys and
// meanings only ever grow; amounts are integer cents.
function toPayload(summary, text) {
  const sections = {};
  for (const [id, section] of Object.entries(summary.sections)) {
    sections[id] = section.error
      ? { title: section.title, data: null, error: section.error }
      : { title: section.title, data: section.data };
  }
  return {
    schemaVersion: summary.schemaVersion,
    generatedAt: summary.generatedAt,
    delivery: summary.delivery,
    period: summary.period,
    month: summary.month,
    text,
    sections,
  };
}

function toMessage(summary) {
  const title = `Budget summary: ${summary.delivery.name || PERIOD_LABELS[summary.delivery.period]}`;
  const text = toText(summary);
  return {
    title,
    text,
    markdown: toMarkdown(title, summary),
    html: toHtml(title, summary),
    data: toPayload(summary, text),
  };
}

module.exports = { toMessage, PERIOD_LABELS, escapeHtml };
