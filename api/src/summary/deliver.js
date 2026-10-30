const { getActualClient, syncIfDue } = require('../actual-client');
const { notify } = require('../notify');
const { buildSummary } = require('./build-summary');
const { toMessage, escapeHtml } = require('./formatters');
const { appendHistory, markReported } = require('./history-store');
const { readSettings } = require('./settings-store');

// Two retries over about 10 minutes before giving up and alerting.
const RETRY_DELAYS_MS = [2 * 60 * 1000, 6 * 60 * 1000];

const CHANNEL_NOT_FOUND = 'channel not found';
const BUILD_FAILED = 'could not build the summary';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freshen(client, trigger, syncIfDueImpl) {
  // A schedule shares the normal sync throttle; someone pressing Send now
  // wants the very latest imports, so that forces a sync.
  try {
    if (trigger === 'schedule') await syncIfDueImpl(client);
    else await client.sync();
  } catch (err) {
    // Stale data beats no summary; the next sync will catch up.
    console.error('summary: sync before building failed:', (err && err.message) || err);
  }
}

// Sends, retrying transient failures. A missing channel won't fix itself
// by waiting, so it fails at once.
// A manual "Send now" passes retry: false: someone is watching the button, so
// it reports the first failure straight away instead of holding the request
// open for the retry waits.
async function sendWithRetries(channelId, message, { notifyImpl, sleep, dataDir, retry = true }) {
  if (!channelId) return { ok: false, error: CHANNEL_NOT_FOUND };
  let result = await notifyImpl(channelId, message, { dataDir });
  for (const delay of retry ? RETRY_DELAYS_MS : []) {
    if (result.ok || result.error === CHANNEL_NOT_FOUND) break;
    await sleep(delay);
    result = await notifyImpl(channelId, message, { dataDir });
  }
  return result;
}

function failureAlert(delivery, error) {
  const text = `The budget summary "${delivery.name}" could not be sent: ${error}`;
  return {
    title: 'Budget summary failed',
    text,
    markdown: `**Budget summary failed**\n\n${text}`,
    html: `<p><strong>Budget summary failed</strong></p><p>${escapeHtml(text)}</p>`,
    data: { event: 'summary-failed', delivery: { id: delivery.id, name: delivery.name }, error },
  };
}

// Builds and sends one delivery's summary, then records the outcome in send
// history. On final failure, sends one alert to settings.failureChannelId;
// if that fails too, the history entry says so. Ids the summary reported
// are marked only after a successful send. Never throws.
// trigger: 'schedule' | 'manual' | 'catch-up'.
async function deliver({
  deliveryId,
  trigger,
  now = new Date(),
  dataDir,
  getClient = getActualClient,
  syncIfDueImpl = syncIfDue,
  buildImpl = buildSummary,
  notifyImpl = notify,
  sleep = defaultSleep,
}) {
  let settings;
  let delivery;
  try {
    settings = await readSettings(dataDir);
    delivery = settings.deliveries.find((d) => d.id === deliveryId);
  } catch (err) {
    console.error('summary: could not read settings:', err && err.code ? err.code : 'unexpected error');
    return { ok: false, error: 'could not read summary settings' };
  }
  if (!delivery) return { ok: false, error: 'delivery not found' };

  let result;
  let summary;
  let reportedIds = [];
  try {
    const client = await getClient();
    await freshen(client, trigger, syncIfDueImpl);
    ({ summary, reportedIds } = await buildImpl({ client, now, delivery, settings, dataDir }));
  } catch (err) {
    console.error(`summary: building "${delivery.id}" failed:`, (err && err.message) || err);
    result = { ok: false, error: BUILD_FAILED };
  }

  try {
    if (!result) {
      result = await sendWithRetries(delivery.channelId, toMessage(summary), {
        notifyImpl,
        sleep,
        dataDir,
        retry: trigger !== 'manual',
      });
    }

    let error = result.ok ? undefined : result.error;
    // The person pressing Send now sees the error on screen; no push alert.
    if (!result.ok && trigger !== 'manual' && settings.failureChannelId) {
      const alert = await notifyImpl(settings.failureChannelId, failureAlert(delivery, result.error), { dataDir });
      if (!alert.ok) error = `${error}; failure alert not sent: ${alert.error}`;
    }

    await appendHistory(
      { at: now.toISOString(), deliveryId: delivery.id, deliveryName: delivery.name, ok: result.ok, error, trigger },
      dataDir
    );
    if (result.ok) await markReported(delivery.id, reportedIds, now, dataDir);
  } catch (err) {
    // notify() never throws, so this is the history file itself; nothing
    // else to record it in.
    console.error('summary: recording the outcome failed:', err && err.code ? err.code : 'unexpected error');
    if (!result) result = { ok: false, error: 'unexpected error' };
  }

  return result.ok ? { ok: true, summary } : { ok: false, error: result.error, summary };
}

module.exports = { deliver, RETRY_DELAYS_MS };
