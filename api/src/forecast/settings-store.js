const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Same data dir as goals-store.js. No secrets live here (the channel holds
// those), so the default file mode is fine.
const DATA_DIR = process.env.INSIGHTS_DATA_DIR || process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'forecast-settings.json';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultSettings() {
  return { enabled: false, windowDays: 15, time: '07:00', channelId: null, accounts: {} };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Stored (or submitted) settings laid over the defaults, so a key added in
// a later version shows up with its default instead of as undefined.
function mergeOverDefaults(input) {
  const base = defaultSettings();
  const given = isPlainObject(input) ? input : {};
  for (const key of Object.keys(base)) {
    if (key in given) base[key] = given[key];
  }
  return base;
}

// Missing file -> defaults. A corrupt-but-present file propagates its parse
// error rather than silently resetting (the next save would wipe it).
async function readSettings(dataDir = DATA_DIR) {
  try {
    const raw = await fs.readFile(path.join(dataDir, FILE_NAME), 'utf8');
    return mergeOverDefaults(JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return defaultSettings();
    throw err;
  }
}

// Temp file plus rename, like goals-store.js.
async function writeSettings(settings, dataDir = DATA_DIR) {
  const finalPath = path.join(dataDir, FILE_NAME);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(settings));
  await fs.rename(tmpPath, finalPath);
}

class Invalid extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

function checkBoolean(value, field) {
  if (typeof value !== 'boolean') throw new Invalid('must be true or false', field);
  return value;
}

function checkInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Invalid(max === Infinity ? `must be a whole number of at least ${min}` : `must be a whole number from ${min} to ${max}`, field);
  }
  return value;
}

function checkAccounts(accounts) {
  if (!isPlainObject(accounts)) throw new Invalid('must be an object', 'accounts');
  const clean = {};
  for (const [id, account] of Object.entries(accounts)) {
    const at = `accounts.${id}`;
    if (!isPlainObject(account)) throw new Invalid('must be an object', at);
    clean[id] = {
      enabled: checkBoolean(account.enabled, `${at}.enabled`),
      warningLevelCents: checkInteger(account.warningLevelCents, `${at}.warningLevelCents`, 0, Infinity),
    };
  }
  return clean;
}

// { ok: true, settings } with input laid over the defaults and normalized
// (unknown keys dropped), or { ok: false, error, field } naming the first
// bad value by its path.
function validateSettings(input) {
  if (!isPlainObject(input)) return { ok: false, error: 'settings must be an object', field: 'settings' };
  try {
    const merged = mergeOverDefaults(input);
    const enabled = checkBoolean(merged.enabled, 'enabled');
    const windowDays = checkInteger(merged.windowDays, 'windowDays', 1, 30);
    if (typeof merged.time !== 'string' || !TIME_PATTERN.test(merged.time)) {
      throw new Invalid('must be HH:MM (24-hour)', 'time');
    }
    const channelId = merged.channelId ?? null;
    if (channelId !== null && (typeof channelId !== 'string' || channelId.length === 0)) {
      throw new Invalid('must be a channel id', 'channelId');
    }
    // A daily check with nowhere to send would run silently forever.
    if (enabled && channelId === null) throw new Invalid('Pick a channel to turn on the daily check', 'channelId');
    const accounts = checkAccounts(merged.accounts);

    return { ok: true, settings: { enabled, windowDays, time: merged.time, channelId, accounts } };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message, field: err.field };
    throw err;
  }
}

module.exports = { defaultSettings, readSettings, writeSettings, validateSettings, DATA_DIR };
