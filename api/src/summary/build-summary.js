const { buildContext } = require('./context');
const { lastSuccessAt, readReported } = require('./history-store');
const { resolvePeriod } = require('./period');
const { SECTIONS } = require('./sections');

// Builds one structured summary for a delivery (saved or an unsaved draft).
// Each enabled section runs in registry order; a section that throws
// becomes { title, data: null, error } and the rest still build. Returns
// the transaction ids the sections reported, which the deliverer marks only
// after a successful send (a preview never marks anything).
async function buildSummary({ client, now, delivery, settings, dataDir }) {
  const lastSentAt = delivery.id ? await lastSuccessAt(delivery.id, dataDir) : null;
  const period = resolvePeriod(delivery.period, now, lastSentAt);
  const reported = delivery.id ? await readReported(delivery.id, dataDir) : new Set();
  const ctx = await buildContext({ client, now, period, settings, delivery, reportedIds: reported, lastSentAt });

  const sections = {};
  const reportedIds = [];
  for (const section of SECTIONS) {
    if (!settings.sections[section.id] || !settings.sections[section.id].enabled) continue;
    try {
      const result = await section.build(ctx);
      if (!result) continue;
      sections[section.id] = { title: section.title, data: result.data, lines: result.lines };
      if (result.reportedIds) reportedIds.push(...result.reportedIds);
    } catch (err) {
      // Actual's own errors carry no channel secrets; the message helps debugging.
      console.error(`summary section ${section.id} failed:`, (err && err.message) || err);
      sections[section.id] = { title: section.title, data: null, error: 'could not be built' };
    }
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    delivery: { id: delivery.id, name: delivery.name, period: delivery.period },
    period: { start: period.start, end: period.end },
    month: ctx.month,
    sections,
  };
  return { summary, reportedIds };
}

module.exports = { buildSummary };
