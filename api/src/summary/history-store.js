const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Same data dir as goals-store.js. summary-history.json holds
// { history: [...newest first], reported: { [deliveryId]: { [txId]: ISO } } }.
// History keeps outcome and error text only: never message bodies or
// secrets (errors arrive already scrubbed by notify()).
const DATA_DIR = process.env.INSIGHTS_DATA_DIR || process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'summary-history.json';
const HISTORY_LIMIT = 100;
const REPORTED_TTL_MS = 90 * 24 * 60 * 60 * 1000;

async function readFile(dataDir) {
  try {
    const raw = await fs.readFile(path.join(dataDir, FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      reported: parsed.reported && typeof parsed.reported === 'object' ? parsed.reported : {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { history: [], reported: {} };
    throw err;
  }
}

async function writeFile(contents, dataDir) {
  const finalPath = path.join(dataDir, FILE_NAME);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(contents));
  await fs.rename(tmpPath, finalPath);
}

// Read-modify-write calls are chained per data dir, so two deliveries
// finishing together can't drop each other's entries.
const queues = new Map();
function update(dataDir, mutate) {
  const prior = queues.get(dataDir) || Promise.resolve();
  const run = prior.then(async () => {
    const contents = await readFile(dataDir);
    mutate(contents);
    await writeFile(contents, dataDir);
  });
  const settled = run.catch(() => {});
  queues.set(dataDir, settled);
  settled.then(() => {
    if (queues.get(dataDir) === settled) queues.delete(dataDir);
  });
  return run;
}

// entry: { at: ISO, deliveryId, deliveryName, ok, error?, trigger }.
// Only those fields are stored, whatever else the caller passes.
function appendHistory(entry, dataDir = DATA_DIR) {
  const clean = {
    at: entry.at,
    deliveryId: entry.deliveryId,
    deliveryName: entry.deliveryName,
    ok: Boolean(entry.ok),
    trigger: entry.trigger,
  };
  if (!entry.ok && entry.error) clean.error = String(entry.error);
  return update(dataDir, (contents) => {
    contents.history = [clean, ...contents.history].slice(0, HISTORY_LIMIT);
  });
}

async function readHistory(dataDir = DATA_DIR) {
  return (await readFile(dataDir)).history;
}

// When this delivery last went out successfully, by any trigger.
async function lastSuccessAt(deliveryId, dataDir = DATA_DIR) {
  const found = (await readHistory(dataDir)).find((e) => e.deliveryId === deliveryId && e.ok);
  return found ? new Date(found.at) : null;
}

// Transaction ids this delivery has already listed (New Since Last Summary).
async function readReported(deliveryId, dataDir = DATA_DIR) {
  const { reported } = await readFile(dataDir);
  return new Set(Object.keys(reported[deliveryId] || {}));
}

// Records ids as reported at `now`, and prunes anything (for any delivery)
// reported more than 90 days before `now`.
function markReported(deliveryId, transactionIds, now, dataDir = DATA_DIR) {
  const cutoff = now.getTime() - REPORTED_TTL_MS;
  return update(dataDir, (contents) => {
    const forDelivery = { ...(contents.reported[deliveryId] || {}) };
    for (const id of transactionIds) forDelivery[id] = now.toISOString();
    contents.reported[deliveryId] = forDelivery;

    for (const [id, ids] of Object.entries(contents.reported)) {
      const kept = Object.fromEntries(Object.entries(ids).filter(([, at]) => new Date(at).getTime() >= cutoff));
      if (Object.keys(kept).length > 0) contents.reported[id] = kept;
      else delete contents.reported[id];
    }
  });
}

module.exports = { appendHistory, readHistory, lastSuccessAt, readReported, markReported, HISTORY_LIMIT, DATA_DIR };
