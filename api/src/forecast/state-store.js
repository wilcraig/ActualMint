const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Same data dir as goals-store.js. forecast-history.json holds
// { history: [...newest first], state: { [accountId]: { firstDate,
// shortfallCents, sentAt } } }. State is what the last warning said, so the
// next run only re-warns when the shortfall changes. History keeps outcome
// and error text only: never message bodies or secrets.
const DATA_DIR = process.env.INSIGHTS_DATA_DIR || process.env.ACTUALMINT_DATA_DIR || '/data';

const FILE_NAME = 'forecast-history.json';
const HISTORY_LIMIT = 50;

async function readFile(dataDir) {
  try {
    const raw = await fs.readFile(path.join(dataDir, FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    // Valid JSON that is not an object (e.g. `null`) holds nothing: treat it
    // like a missing file. Corrupt JSON still throws.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { history: [], state: {} };
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      state: parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state) ? parsed.state : {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { history: [], state: {} };
    throw err;
  }
}

async function writeFile(contents, dataDir) {
  const finalPath = path.join(dataDir, FILE_NAME);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(contents));
  await fs.rename(tmpPath, finalPath);
}

// Read-modify-write calls are chained per data dir, so a state write and a
// history append finishing together can't drop each other's data.
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

async function readState(dataDir = DATA_DIR) {
  return (await readFile(dataDir)).state;
}

// Replaces the whole state.
function writeState(state, dataDir = DATA_DIR) {
  return update(dataDir, (contents) => {
    contents.state = state;
  });
}

// entry: { at: ISO, ok, trigger, warned: [accountId], error? }.
// Only those fields are stored, whatever else the caller passes.
function appendHistory(entry, dataDir = DATA_DIR) {
  const clean = {
    at: entry.at,
    ok: Boolean(entry.ok),
    trigger: entry.trigger,
    warned: Array.isArray(entry.warned) ? [...entry.warned] : [],
  };
  if (!entry.ok && entry.error) clean.error = String(entry.error);
  return update(dataDir, (contents) => {
    contents.history = [clean, ...contents.history].slice(0, HISTORY_LIMIT);
  });
}

async function readHistory(dataDir = DATA_DIR) {
  return (await readFile(dataDir)).history;
}

module.exports = { readState, writeState, appendHistory, readHistory, HISTORY_LIMIT, DATA_DIR };
