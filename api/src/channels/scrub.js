const { CHANNEL_TYPES } = require('./registry');

// Every stored secret value for this channel, plus the shapes it can take
// inside an error message: URL-encoded, and for URL secrets the last path
// segment (a webhook token often appears alone, e.g. in a path-only log).
function secretValues(type, config) {
  const channelType = CHANNEL_TYPES[type];
  if (!channelType || !config) return [];

  const values = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0) values.add(value);
  };

  for (const field of channelType.fields) {
    if (!field.secret) continue;
    const raw = config[field.key];

    if (field.kind === 'headers') {
      for (const header of Array.isArray(raw) ? raw : []) add(header && header.value);
      continue;
    }
    if (typeof raw !== 'string' || raw.length === 0) continue;

    add(raw);
    add(encodeURIComponent(raw));
    if (field.kind === 'url') {
      const segment = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).pop();
      if (segment && segment !== raw) add(segment);
    }
    // Apprise-style comma lists: each target is its own secret.
    if (raw.includes(',')) raw.split(',').forEach((part) => add(part.trim()));
  }
  return [...values];
}

// Longest first, so a value that contains a shorter one is replaced whole.
function scrubSecrets(text, values) {
  let out = String(text);
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    out = out.split(value).join('***');
  }
  return out;
}

module.exports = { secretValues, scrubSecrets };
