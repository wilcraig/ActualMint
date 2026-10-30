const express = require('express');
const { q } = require('@actual-app/api');

const { getActualClient, syncIfDue } = require('../actual-client');
const { readChannels } = require('../channels/store');
const { buildSummary } = require('../summary/build-summary');
const { deliver } = require('../summary/deliver');
const { toMessage } = require('../summary/formatters');
const { readHistory } = require('../summary/history-store');
const { SECTIONS } = require('../summary/sections');
const { readSettings, writeSettings, validateSettings } = require('../summary/settings-store');

const router = express.Router();

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

function validOrThrow(input) {
  const result = validateSettings(input);
  if (!result.ok) throw new ValidationError(result.error, result.field);
  return result.settings;
}

// A delivery or the failure alert pointing at a channel that doesn't exist
// would only fail at send time; catch it at save time with the field named.
async function checkChannelsExist(settings) {
  const ids = new Set((await readChannels()).map((c) => c.id));
  settings.deliveries.forEach((delivery, index) => {
    if (delivery.channelId && !ids.has(delivery.channelId)) {
      throw new ValidationError('Pick a channel that exists', `deliveries[${index}].channelId`);
    }
  });
  if (settings.failureChannelId && !ids.has(settings.failureChannelId)) {
    throw new ValidationError('Pick a channel that exists', 'failureChannelId');
  }
}

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await readSettings();
    res.status(200).json({
      settings,
      sections: SECTIONS.map(({ id, title }) => ({ id, title })),
      timezone: process.env.TZ || null,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const settings = validOrThrow(req.body);
    await checkChannelsExist(settings);
    await writeSettings(settings);
    res.status(200).json({ settings });
  } catch (err) {
    next(err);
  }
});

// Builds exactly what a delivery would send, without sending it or marking
// anything reported. Body: { deliveryId } for a saved delivery, or
// { delivery, settings? } for unsaved edits (both validated like a save).
router.post('/preview', async (req, res, next) => {
  try {
    const body = req.body || {};
    let settings;
    let delivery;
    if (body.delivery !== undefined) {
      const base = body.settings !== undefined ? body.settings : await readSettings();
      if (base === null || typeof base !== 'object' || Array.isArray(base)) throw new ValidationError('settings must be an object', 'settings');
      settings = validOrThrow({ ...base, deliveries: [body.delivery] });
      [delivery] = settings.deliveries;
    } else {
      settings = await readSettings();
      delivery = settings.deliveries.find((d) => d.id === body.deliveryId);
      if (!delivery) {
        res.status(404).json({ error: 'delivery not found' });
        return;
      }
    }

    const client = await getActualClient();
    await syncIfDue(client);
    const { summary } = await buildSummary({ client, now: new Date(), delivery, settings });
    res.status(200).json({ message: toMessage(summary) });
  } catch (err) {
    next(err);
  }
});

// Sends a saved delivery now and waits for the outcome, retries included
// (deliver() records it in history either way).
router.post('/send', async (req, res, next) => {
  try {
    const { deliveryId } = req.body || {};
    const settings = await readSettings();
    if (!settings.deliveries.some((d) => d.id === deliveryId)) {
      res.status(404).json({ error: 'delivery not found' });
      return;
    }
    const result = await deliver({ deliveryId, trigger: 'manual', now: new Date() });
    res.status(200).json(result.ok ? { ok: true } : { ok: false, error: result.error });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    res.status(200).json({ history: await readHistory() });
  } catch (err) {
    next(err);
  }
});

// Choices for the Exclude from updates pickers: payees (minus the
// per-account transfer payees, which are never spending) and open schedules.
router.get('/options', async (req, res, next) => {
  try {
    const client = await getActualClient();
    await syncIfDue(client);
    const [{ data: payees }, schedules] = await Promise.all([client.aqlQuery(q('payees').select('*')), client.getSchedules()]);
    const payeeNames = new Map((payees || []).map((p) => [p.id, p.name]));
    res.status(200).json({
      payees: (payees || []).filter((p) => !p.transfer_acct && p.name).map(({ id, name }) => ({ id, name })),
      schedules: (schedules || [])
        .filter((s) => !s.completed)
        .map((s) => ({ id: s.id, name: s.name || payeeNames.get(s.payee) || '(No payee)' })),
    });
  } catch (err) {
    next(err);
  }
});

// Validation problems are the caller's; anything else is ours and is
// reported without echoing internals.
router.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return;
  }
  console.error('summaries route failed:', err && err.code ? err.code : 'unexpected error');
  res.status(500).json({ error: 'internal error' });
});

module.exports = router;
