const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const { PERIOD_KINDS } = require('./period');

// Same data dir as goals-store.js. No secrets live here (channels hold
// those), so the default file mode is fine.
const DATA_DIR = process.env.INSIGHTS_DATA_DIR || process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'summary-settings.json';

const MAX_DELIVERIES = 20;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// One shared set of sections serves every delivery. Each section's keys
// here are the whole of its settings; validateSettings drops anything else.
function defaultSettings() {
  return {
    sections: {
      pacing: { enabled: true, tolerancePct: 10, categoryIds: [] },
      largest: { enabled: true, count: 5, minAmountCents: 0, excludeScheduled: true },
      upcoming: { enabled: true, lookAheadDays: 7, minAmountCents: 0 },
      watched: { enabled: false, categoryIds: [] },
      alerts: { enabled: false, categoryIds: [] },
    },
    exclusions: { categoryIds: [], payeeIds: [], scheduleIds: [] },
    failureChannelId: null,
    deliveries: [],
  };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Stored (or submitted) settings laid over the defaults, one level into
// each section and the exclusions, so a key added in a later version shows
// up with its default instead of as undefined.
function mergeOverDefaults(input) {
  const base = defaultSettings();
  const given = isPlainObject(input) ? input : {};
  const sections = isPlainObject(given.sections) ? given.sections : {};
  for (const id of Object.keys(base.sections)) {
    if (isPlainObject(sections[id])) base.sections[id] = { ...base.sections[id], ...sections[id] };
  }
  if (isPlainObject(given.exclusions)) base.exclusions = { ...base.exclusions, ...given.exclusions };
  if ('failureChannelId' in given) base.failureChannelId = given.failureChannelId;
  if ('deliveries' in given) base.deliveries = given.deliveries;
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

function checkIdList(value, field) {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Invalid('must be a list of ids', field);
  }
  return [...new Set(value)];
}

function checkSections(sections) {
  const { pacing, largest, upcoming, watched, alerts } = sections;
  return {
    pacing: {
      enabled: checkBoolean(pacing.enabled, 'sections.pacing.enabled'),
      tolerancePct: checkInteger(pacing.tolerancePct, 'sections.pacing.tolerancePct', 0, 100),
      categoryIds: checkIdList(pacing.categoryIds, 'sections.pacing.categoryIds'),
    },
    largest: {
      enabled: checkBoolean(largest.enabled, 'sections.largest.enabled'),
      count: checkInteger(largest.count, 'sections.largest.count', 1, 25),
      minAmountCents: checkInteger(largest.minAmountCents, 'sections.largest.minAmountCents', 0, Infinity),
      excludeScheduled: checkBoolean(largest.excludeScheduled, 'sections.largest.excludeScheduled'),
    },
    upcoming: {
      enabled: checkBoolean(upcoming.enabled, 'sections.upcoming.enabled'),
      lookAheadDays: checkInteger(upcoming.lookAheadDays, 'sections.upcoming.lookAheadDays', 1, 60),
      minAmountCents: checkInteger(upcoming.minAmountCents, 'sections.upcoming.minAmountCents', 0, Infinity),
    },
    watched: {
      enabled: checkBoolean(watched.enabled, 'sections.watched.enabled'),
      categoryIds: checkIdList(watched.categoryIds, 'sections.watched.categoryIds'),
    },
    alerts: {
      enabled: checkBoolean(alerts.enabled, 'sections.alerts.enabled'),
      categoryIds: checkIdList(alerts.categoryIds, 'sections.alerts.categoryIds'),
    },
  };
}

function checkDelivery(delivery, index, seenIds) {
  const at = `deliveries[${index}]`;
  if (!isPlainObject(delivery)) throw new Invalid('must be an object', at);

  if (typeof delivery.id !== 'string' || delivery.id.length === 0) throw new Invalid('id is required', `${at}.id`);
  if (seenIds.has(delivery.id)) throw new Invalid('id is used twice', `${at}.id`);
  seenIds.add(delivery.id);

  if (typeof delivery.name !== 'string' || delivery.name.trim() === '') throw new Invalid('Name is required', `${at}.name`);
  const channelId = delivery.channelId ?? null;
  if (channelId !== null && (typeof channelId !== 'string' || channelId.length === 0)) {
    throw new Invalid('must be a channel id', `${at}.channelId`);
  }
  if (!PERIOD_KINDS.includes(delivery.period)) throw new Invalid(`must be one of ${PERIOD_KINDS.join(', ')}`, `${at}.period`);

  const { schedule } = delivery;
  if (!isPlainObject(schedule)) throw new Invalid('must have days and times', `${at}.schedule`);
  const { days, times } = schedule;
  if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new Invalid('days must be weekday numbers 0 (Sunday) to 6', `${at}.schedule.days`);
  }
  if (!Array.isArray(times) || !times.every((t) => typeof t === 'string' && TIME_PATTERN.test(t))) {
    throw new Invalid('times must be HH:MM (24-hour)', `${at}.schedule.times`);
  }

  return {
    id: delivery.id,
    name: delivery.name.trim(),
    enabled: checkBoolean(delivery.enabled, `${at}.enabled`),
    channelId,
    period: delivery.period,
    schedule: {
      days: [...new Set(days)].sort((a, b) => a - b),
      times: [...new Set(times)].sort(),
    },
  };
}

// { ok: true, settings } with input laid over the defaults and normalized
// (unknown keys dropped, days and times sorted and de-duplicated), or
// { ok: false, error, field } naming the first bad value by its path.
function validateSettings(input) {
  if (!isPlainObject(input)) return { ok: false, error: 'settings must be an object', field: 'settings' };
  try {
    const merged = mergeOverDefaults(input);
    const sections = checkSections(merged.sections);
    const exclusions = {
      categoryIds: checkIdList(merged.exclusions.categoryIds, 'exclusions.categoryIds'),
      payeeIds: checkIdList(merged.exclusions.payeeIds, 'exclusions.payeeIds'),
      scheduleIds: checkIdList(merged.exclusions.scheduleIds, 'exclusions.scheduleIds'),
    };
    const failureChannelId = merged.failureChannelId ?? null;
    if (failureChannelId !== null && (typeof failureChannelId !== 'string' || failureChannelId.length === 0)) {
      throw new Invalid('must be a channel id', 'failureChannelId');
    }
    if (!Array.isArray(merged.deliveries)) throw new Invalid('must be a list', 'deliveries');
    if (merged.deliveries.length > MAX_DELIVERIES) throw new Invalid(`at most ${MAX_DELIVERIES} deliveries`, 'deliveries');
    const seenIds = new Set();
    const deliveries = merged.deliveries.map((d, i) => checkDelivery(d, i, seenIds));

    return { ok: true, settings: { sections, exclusions, failureChannelId, deliveries } };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message, field: err.field };
    throw err;
  }
}

module.exports = { defaultSettings, readSettings, writeSettings, validateSettings, DATA_DIR, MAX_DELIVERIES };
