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

function openClient() {
  const { ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_E2E_PASSWORD } = process.env;
  return api
    .init({ serverURL: ACTUAL_SERVER_URL, password: ACTUAL_SERVER_PASSWORD })
    .then(() => api.downloadBudget(ACTUAL_SYNC_ID, { password: ACTUAL_E2E_PASSWORD || undefined }))
    .then(() => {
      // downloadBudget() already performs an initial sync; start the
      // throttle window from here so a request arriving immediately after
      // init doesn't trigger a redundant second sync.
      lastSyncAt = Date.now();
      return api;
    });
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
