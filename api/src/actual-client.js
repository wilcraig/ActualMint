const api = require('@actual-app/api');

// Mirrors jhonderson/actual-http-api's actual-client-provider: one shared
// Actual client, torn down and re-created on a timer so long-running memory
// and sync state never go stale.
const RECYCLE_MS = 60 * 60 * 1000;

let clientPromise = null;
let recycleTimer = null;
let everConnected = false;

function openClient() {
  const { ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_E2E_PASSWORD } = process.env;
  return api
    .init({ serverURL: ACTUAL_SERVER_URL, password: ACTUAL_SERVER_PASSWORD })
    .then(() => api.downloadBudget(ACTUAL_SYNC_ID, { password: ACTUAL_E2E_PASSWORD || undefined }))
    .then(() => api);
}

function scheduleRecycle() {
  clearTimeout(recycleTimer);
  recycleTimer = setTimeout(recycle, RECYCLE_MS);
  // The HTTP listener keeps the process alive; the recycle timer must not on its own.
  recycleTimer.unref();
}

async function recycle() {
  recycleTimer = null;
  clientPromise = null;
  try {
    await api.shutdown();
  } catch (err) {
    console.error('actual-client: shutdown failed during recycle', err);
  }
}

function getActualClient() {
  if (!clientPromise) {
    clientPromise = openClient().then(
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

module.exports = { getActualClient, hasEverConnected, RECYCLE_MS };
