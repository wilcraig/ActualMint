const express = require('express');

const { getActualClient, syncIfDue } = require('../actual-client');
const { readChannels } = require('../channels/store');
const { previewCheck, sendTest } = require('../forecast/run');
const { readSettings, writeSettings, validateSettings } = require('../forecast/settings-store');
const { readHistory } = require('../forecast/state-store');

const router = express.Router();

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

// On-budget, open accounts: the only ones the forecast can watch.
async function eligibleAccounts(client) {
  return ((await client.getAccounts()) || []).filter((a) => !a.offbudget && !a.closed);
}

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await readSettings();
    const client = await getActualClient();
    await syncIfDue(client);
    const accounts = await Promise.all(
      (await eligibleAccounts(client)).map(async (a) => ({ id: a.id, name: a.name, balanceCents: await client.getAccountBalance(a.id) }))
    );
    res.status(200).json({ settings, accounts, timezone: process.env.TZ || null });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const result = validateSettings(req.body);
    if (!result.ok) throw new ValidationError(result.error, result.field);
    const settings = result.settings;

    if (settings.channelId && !(await readChannels()).some((c) => c.id === settings.channelId)) {
      throw new ValidationError('Pick a channel that exists', 'channelId');
    }

    // Ids that are not eligible accounts are dropped, never an error.
    const client = await getActualClient();
    const ids = new Set((await eligibleAccounts(client)).map((a) => a.id));
    settings.accounts = Object.fromEntries(Object.entries(settings.accounts).filter(([id]) => ids.has(id)));

    await writeSettings(settings);
    res.status(200).json({ settings });
  } catch (err) {
    next(err);
  }
});

// Computes the forecast for the saved settings. Sends nothing, records nothing.
router.post('/check', async (req, res, next) => {
  try {
    res.status(200).json({ forecast: await previewCheck({}) });
  } catch (err) {
    next(err);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    if (!(await readSettings()).channelId) {
      res.status(400).json({ error: 'Pick a channel first' });
      return;
    }
    res.status(200).json(await sendTest({}));
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

router.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return;
  }
  console.error('forecast route failed:', err && err.code ? err.code : 'unexpected error');
  res.status(500).json({ error: 'internal error' });
});

module.exports = router;
