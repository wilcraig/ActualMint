const api = require('@actual-app/api');

// Mirrors jhonderson/actual-http-api's actual-client-provider: one shared
// Actual client, torn down and re-created on a timer so long-running memory
// and sync state never go stale.
const RECYCLE_MS = 60 * 60 * 1000;

// How often a request may trigger a fresh client.sync() call. Without this,
// data entered in Actual (or a new SimpleFIN import) wouldn't show up in the
// pacing bars until the hourly recycle — up to an hour stale, which defeats
// the point of a "glance and know where you stand" widget. 45s keeps the
// widget close to live without hammering the Actual server on every request.
const SYNC_THROTTLE_MS = 45 * 1000;

let clientPromise = null;
let recycleTimer = null;
let closing = null; // settles once the previous api.shutdown() has finished; never rejects
let everConnected = false;
let lastSyncAt = 0; // ms, per Date.now(); 0 means "never synced in this process"
let syncInFlight = null; // the in-flight sync() promise, shared by concurrent callers; never rejects

// downloadBudget() always performs a full-history CRDT resync from message
// zero, regardless of what's already cached on disk -- fine for a small
// budget, but this household's message log has grown past ~250k messages
// (years of imported history plus the categorization/duplicate-merge
// recovery work), where a full resync reliably takes 40-90+ seconds and has
// been observed to fail outright (EPIPE/network-failure). Every recycle
// (hourly, see RECYCLE_MS) called downloadBudget() again, so once an hour
// every widget on the page would hang -- sharing the one clientPromise
// below -- for however long that resync took, or error out entirely.
//
// loadBudget() + sync(), by contrast, opens the budget from whatever's
// already on disk (same dataDir, which survives a recycle since that only
// tears down the in-process @actual-app/api connection, not the container's
// filesystem) and catches up incrementally -- the same fast, reliable path
// proven out manually against this exact budget during the recovery work.
// So: only the very first connection this container ever makes (no local
// cache yet) pays the slow/fragile downloadBudget() cost; every recycle
// after that reuses the local cache instead.
async function findCachedLocalBudgetId(syncId) {
  try {
    const localBudgets = await api.getBudgets();
    // getBudgets() returns both locally-downloaded budgets (which have an
    // `id` -- the local folder name loadBudget() takes) and budgets that
    // only exist on the server so far (no `id`, `state: "remote"`); only
    // the former is usable here. Despite its field name, `ACTUAL_SYNC_ID`
    // in this deployment's .env is the sync *group* id, matching each
    // entry's `groupId` -- confirmed by direct inspection: the local
    // entry's groupId equals the exact value downloadBudget() has always
    // been called with throughout this project, not its cloudFileId.
    const match = (localBudgets || []).find((b) => b.id && b.groupId === syncId);
    return match ? match.id : null;
  } catch (err) {
    // A failure here just means "assume no cache" -- downloadBudget() is
    // always a safe (if slower) fallback, never a hard failure.
    console.error('actual-client: getBudgets failed while checking for a local cache', err);
    return null;
  }
}

async function openClient() {
  const { ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_E2E_PASSWORD } = process.env;
  await api.init({ serverURL: ACTUAL_SERVER_URL, password: ACTUAL_SERVER_PASSWORD });

  const cachedId = await findCachedLocalBudgetId(ACTUAL_SYNC_ID);
  if (cachedId) {
    await api.loadBudget(cachedId);
    await api.sync();
  } else {
    await api.downloadBudget(ACTUAL_SYNC_ID, { password: ACTUAL_E2E_PASSWORD || undefined });
  }

  // Either path above already performs a sync; start the throttle window
  // from here so a request arriving immediately after init doesn't trigger
  // a redundant second one.
  lastSyncAt = Date.now();
  return api;
}

function scheduleRecycle() {
  clearTimeout(recycleTimer);
  recycleTimer = setTimeout(recycle, RECYCLE_MS);
  // The HTTP listener keeps the process alive; the recycle timer must not on its own.
  recycleTimer.unref();
}

async function closeClient() {
  try {
    await api.shutdown();
  } catch (err) {
    console.error('actual-client: shutdown failed during recycle', err);
  }
}

function recycle() {
  recycleTimer = null;
  clientPromise = null;
  lastSyncAt = 0;
  syncInFlight = null;
  // @actual-app/api is a single module, so no new init may start until this shutdown has settled.
  const pending = closeClient();
  closing = pending;
  pending.then(() => {
    if (closing === pending) closing = null;
  });
}

function getActualClient() {
  if (!clientPromise) {
    const ready = closing ? closing.then(openClient) : openClient();
    clientPromise = ready.then(
      (client) => {
        everConnected = true;
        scheduleRecycle();
        return client;
      },
      (err) => {
        // Drop the failed attempt so the next call retries from scratch.
        clientPromise = null;
        throw err;
      }
    );
  }
  return clientPromise;
}

// True once getActualClient() has resolved at least once in this process.
function hasEverConnected() {
  return everConnected;
}

// Refreshes data from the Actual server, at most once per SYNC_THROTTLE_MS.
// Concurrent callers during the throttle window's in-flight sync share that
// same promise rather than each triggering their own sync() call; callers
// arriving once the window has elapsed (and no sync is in flight) trigger a
// new one. Must be called with an already-initialized client.
function syncIfDue(client) {
  const now = Date.now();

  if (syncInFlight) {
    return syncInFlight;
  }

  if (now - lastSyncAt < SYNC_THROTTLE_MS) {
    return Promise.resolve();
  }

  syncInFlight = Promise.resolve(client.sync())
    .catch((err) => {
      // A failed sync shouldn't wedge the throttle open forever, but it
      // also shouldn't be silently swallowed; log and let the next request
      // past the throttle window retry.
      console.error('actual-client: sync failed', err);
    })
    .finally(() => {
      lastSyncAt = Date.now();
      syncInFlight = null;
    });

  return syncInFlight;
}

module.exports = { getActualClient, hasEverConnected, syncIfDue, RECYCLE_MS, SYNC_THROTTLE_MS };
