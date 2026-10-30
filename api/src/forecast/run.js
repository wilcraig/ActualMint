const { getActualClient, syncIfDue } = require('../actual-client');
const { notify } = require('../notify');
const { sendWithRetries } = require('../summary/deliver');
const { escapeHtml } = require('../summary/formatters');
const summarySettingsStore = require('../summary/settings-store');
const { readSettings } = require('./settings-store');
const { readState, writeState, appendHistory } = require('./state-store');
const { computeForecast } = require('./compute');
const { decideWarnings } = require('./change');
const { buildWarningMessage, buildTestMessage } = require('./message');

// The daily low-balance check: compute, decide who is new or changed, send
// with retries, then record state and history. Mirrors summary/deliver.js.

const COMPUTE_FAILED = 'could not compute the forecast';
const STATE_UNREADABLE = 'could not read forecast state';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasEnabledAccount = (settings) => Object.values(settings.accounts || {}).some((a) => a && a.enabled);

// A failed sync is logged and ignored: stale data beats no check.
async function freshen(client, syncIfDueImpl) {
  try {
    await syncIfDueImpl(client);
  } catch (err) {
    console.error('forecast: sync before checking failed:', (err && err.message) || err);
  }
}

async function loadForecast({ now, settings, getClient, syncIfDueImpl, computeImpl }) {
  const client = await getClient();
  await freshen(client, syncIfDueImpl);
  return computeImpl({ client, now, settings });
}

function failureAlert(error) {
  const text = `The cash-flow check could not finish: ${error}`;
  return {
    title: 'Cash-flow check failed',
    text,
    markdown: `**Cash-flow check failed**\n\n${text}`,
    html: `<p><strong>Cash-flow check failed</strong></p><p>${escapeHtml(text)}</p>`,
    data: { schemaVersion: 1, event: 'cash-flow-check-failed', error },
  };
}

// The summary settings own the failure channel; unreadable means no alert.
async function readFailureChannelId(dataDir) {
  try {
    return (await summarySettingsStore.readSettings(dataDir)).failureChannelId || null;
  } catch (err) {
    console.error('forecast: could not read summary settings:', err && err.code ? err.code : 'unexpected error');
    return null;
  }
}

// Runs the scheduled check and records the outcome. Sends one failure alert
// per run for a send that failed after retries, accounts that could not be
// computed, or a forecast that could not be computed at all. State only
// advances for accounts whose warning was sent (or that need none).
// Never throws. trigger: 'schedule' | 'catch-up'.
async function runCheck({
  trigger,
  now = new Date(),
  dataDir,
  getClient = getActualClient,
  syncIfDueImpl = syncIfDue,
  computeImpl = computeForecast,
  notifyImpl = notify,
  sleep = defaultSleep,
}) {
  let settings;
  try {
    settings = await readSettings(dataDir);
  } catch (err) {
    console.error('forecast: could not read settings:', err && err.code ? err.code : 'unexpected error');
    return { ok: false, sent: false, error: 'could not read forecast settings' };
  }
  if (!settings.channelId || !hasEnabledAccount(settings)) return { ok: true, sent: false };

  let forecast;
  const problems = [];
  let sent = false;
  let sendError;
  let warned = [];
  try {
    try {
      forecast = await loadForecast({ now, settings, getClient, syncIfDueImpl, computeImpl });
    } catch (err) {
      console.error('forecast: computing the check failed:', (err && err.message) || err);
      problems.push(COMPUTE_FAILED);
    }

    if (forecast) {
      for (const e of forecast.errors || []) problems.push(`${e.accountName}: ${e.error}`);

      // Accounts in errors are left out, so decideWarnings keeps their state.
      const breaches = {};
      for (const r of forecast.results) breaches[r.accountId] = r.breach ? { date: r.breach.date, shortfallCents: r.breach.shortfallCents } : null;
      // Unreadable state skips sending (we can't tell what was already said)
      // but still reaches the failure alert below.
      let state;
      try {
        state = await readState(dataDir);
      } catch (err) {
        console.error('forecast: could not read state:', err && err.code ? err.code : (err && err.name) || 'unexpected error');
        problems.push(STATE_UNREADABLE);
      }
      if (state) {
        const { toSend, nextState } = decideWarnings({ breaches, state, now, today: forecast.today });
        if (toSend.length > 0) {
          const warnings = forecast.results.filter((r) => toSend.includes(r.accountId));
          const message = buildWarningMessage({ warnings, windowDays: forecast.windowDays, generatedAt: forecast.generatedAt });
          const result = await sendWithRetries(settings.channelId, message, { notifyImpl, sleep, dataDir, retry: true });
          if (result.ok) {
            sent = true;
            warned = toSend;
            await writeState(nextState, dataDir);
          } else {
            sendError = result.error || 'unexpected error';
            problems.unshift(sendError);
          }
        } else {
          await writeState(nextState, dataDir);
        }
      }
    }

    let error = problems.length > 0 ? problems.join('; ') : undefined;
    if (error) {
      const failureChannelId = await readFailureChannelId(dataDir);
      if (failureChannelId) {
        const alert = await notifyImpl(failureChannelId, failureAlert(error), { dataDir });
        if (!alert.ok) error = `${error}; failure alert not sent: ${alert.error}`;
      }
    }

    await appendHistory({ at: now.toISOString(), ok: !error, trigger, warned, error }, dataDir);
    return error ? { ok: false, sent, error: sendError || error, forecast } : { ok: true, sent, forecast };
  } catch (err) {
    // notify() never throws, so this is a state or history file.
    console.error('forecast: recording the check failed:', err && err.code ? err.code : 'unexpected error');
    return { ok: false, sent, error: sendError || 'unexpected error', forecast };
  }
}

// "Check now": computes and returns the forecast. Sends nothing and touches
// no state or history. Never throws; a failure comes back as { error }.
async function previewCheck({
  now = new Date(),
  dataDir,
  getClient = getActualClient,
  syncIfDueImpl = syncIfDue,
  computeImpl = computeForecast,
}) {
  let settings;
  try {
    settings = await readSettings(dataDir);
  } catch (err) {
    console.error('forecast: could not read settings:', err && err.code ? err.code : 'unexpected error');
    return { generatedAt: now.toISOString(), results: [], errors: [], error: 'could not read forecast settings' };
  }
  try {
    return await loadForecast({ now, settings, getClient, syncIfDueImpl, computeImpl });
  } catch (err) {
    console.error('forecast: computing the preview failed:', (err && err.message) || err);
    return { generatedAt: now.toISOString(), windowDays: settings.windowDays, results: [], errors: [], error: COMPUTE_FAILED };
  }
}

// "Send test message": one attempt to the configured channel, no state.
async function sendTest({ dataDir, notifyImpl = notify }) {
  try {
    const settings = await readSettings(dataDir);
    const result = await sendWithRetries(settings.channelId, buildTestMessage(), { notifyImpl, dataDir, retry: false });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (err) {
    console.error('forecast: test send failed:', err && err.code ? err.code : 'unexpected error');
    return { ok: false, error: 'could not read forecast settings' };
  }
}

module.exports = { runCheck, previewCheck, sendTest };
