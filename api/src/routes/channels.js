const crypto = require('crypto');
const express = require('express');

const { readChannels, writeChannels } = require('../channels/store');
const { CHANNEL_TYPES, listChannelTypes } = require('../channels/registry');
const { notify } = require('../notify');

const router = express.Router();

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

function isBlank(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

// What the browser may see: secret values are dropped and their keys listed
// in `secretsSet`. Header names are not secret (only their values are), so
// the UI still gets `[{ name }]` to render its rows.
function redact(channel) {
  const channelType = CHANNEL_TYPES[channel.type];
  const config = {};
  const secretsSet = [];
  for (const field of channelType ? channelType.fields : []) {
    const value = channel.config && channel.config[field.key];
    if (field.secret) {
      if (!isBlank(value)) secretsSet.push(field.key);
      if (field.kind === 'headers' && Array.isArray(value)) config[field.key] = value.map(({ name }) => ({ name }));
    } else if (value !== undefined) {
      config[field.key] = value;
    }
  }
  return { id: channel.id, name: channel.name, type: channel.type, config, secretsSet };
}

// Headers arrive as [{ name, value }]. On an edit the UI doesn't have the
// stored values, so an entry with no value keeps the stored value of the
// same-named header.
function mergeHeaders(incoming, stored) {
  if (!Array.isArray(incoming)) throw new ValidationError('Headers must be a list', 'headers');
  const storedByName = new Map((Array.isArray(stored) ? stored : []).map((h) => [h.name, h.value]));
  return incoming.map((entry) => {
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) throw new ValidationError('Every header needs a name', 'headers');
    const value = entry.value === undefined || entry.value === null ? storedByName.get(name) ?? '' : String(entry.value);
    return { name, value };
  });
}

// Builds the config to store from the request's `incoming` config, the
// previously stored one (undefined on create), and the type's field list.
// Omitted or null secrets keep the stored value; everything is checked here
// so a bad URL fails at save time with the field named, not at send time.
function buildConfig(channelType, incoming, stored) {
  if (incoming !== undefined && (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming))) {
    throw new ValidationError('config must be an object', 'config');
  }
  const given = incoming || {};
  const config = {};

  for (const field of channelType.fields) {
    const prior = stored ? stored[field.key] : undefined;
    let value = given[field.key];

    if (field.secret && (value === undefined || value === null)) {
      value = prior;
    } else if (value === undefined || value === null) {
      value = stored ? prior : field.default;
    } else if (field.kind === 'headers') {
      value = mergeHeaders(value, prior);
    }

    if (field.required && isBlank(value)) throw new ValidationError(`${field.label} is required`, field.key);
    if (isBlank(value)) continue;

    if (field.kind === 'url') {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new ValidationError(`${field.label} must be a valid URL`, field.key);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationError(`${field.label} must start with http:// or https://`, field.key);
      }
    } else if (field.kind === 'number') {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`${field.label} must be a number`, field.key);
    } else if (field.kind === 'select') {
      value = String(value);
      if (field.options && !field.options.includes(value)) {
        throw new ValidationError(`${field.label} must be one of ${field.options.join(', ')}`, field.key);
      }
    } else if (field.kind !== 'headers' && typeof value !== 'string') {
      throw new ValidationError(`${field.label} must be text`, field.key);
    }
    config[field.key] = value;
  }

  if (channelType.validate) {
    const message = channelType.validate(config);
    if (message) throw new ValidationError(message, 'config');
  }
  return config;
}

function cleanName(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('Name is required', 'name');
  return name.trim();
}

router.get('/', async (req, res, next) => {
  try {
    const channels = await readChannels();
    res.status(200).json({ channels: channels.map(redact), types: listChannelTypes() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, type, config } = req.body || {};
    const channelType = CHANNEL_TYPES[type];
    if (!channelType) throw new ValidationError('Unknown channel type', 'type');

    const channel = { id: crypto.randomUUID(), name: cleanName(name), type, config: buildConfig(channelType, config, undefined) };
    const channels = await readChannels();
    await writeChannels([...channels, channel]);
    res.status(201).json(redact(channel));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const channels = await readChannels();
    const index = channels.findIndex((c) => c.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    const existing = channels[index];
    const { name, config } = req.body || {};
    const channelType = CHANNEL_TYPES[existing.type];

    const updated = {
      ...existing,
      name: name === undefined ? existing.name : cleanName(name),
      config: buildConfig(channelType, config, existing.config),
    };
    const next_ = [...channels];
    next_[index] = updated;
    await writeChannels(next_);
    res.status(200).json(redact(updated));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const channels = await readChannels();
    if (!channels.some((c) => c.id === req.params.id)) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    await writeChannels(channels.filter((c) => c.id !== req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/test', async (req, res, next) => {
  try {
    const channels = await readChannels();
    if (!channels.some((c) => c.id === req.params.id)) {
      res.status(404).json({ error: 'channel not found' });
      return;
    }
    const text = 'This is a test message from Actual Insights.';
    const result = await notify(req.params.id, {
      title: 'Actual Insights test',
      text,
      markdown: `**Actual Insights test**\n\n${text}`,
      html: `<p><strong>Actual Insights test</strong></p><p>${text}</p>`,
      data: { test: true },
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Validation problems are the caller's; anything else is ours and is
// reported without echoing internals (the message could carry a secret).
router.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return;
  }
  console.error('channels route failed:', err && err.code ? err.code : 'unexpected error');
  res.status(500).json({ error: 'internal error' });
});

module.exports = router;
