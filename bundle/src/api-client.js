// Shared authenticated-fetch helper for actualmint-bundle widgets.
//
// actualmint-bundle runs inside Actual Budget's own web page and shares
// Actual's own browser storage. Actual's web client stores its session
// token in IndexedDB (not localStorage): database `actual`, object store
// `asyncStorage`, key `'user-token'` (confirmed against the deployed
// @actual-app/core version's `platform/server/indexeddb` and
// `platform/server/asyncStorage` modules). actualmint-api's token
// validation middleware (see Task 1/2) expects that same token on the
// `X-ACTUAL-TOKEN` header of every `/api/*` request.
//
// This module is the one place that knows how to read that token and
// attach it, so every current and future widget shares it instead of
// each re-implementing its own IndexedDB lookup.

const DB_NAME = 'actual';
const STORE_NAME = 'asyncStorage';
const TOKEN_KEY = 'user-token';
const TOKEN_HEADER = 'X-ACTUAL-TOKEN';

// Opens the `actual` IndexedDB database without specifying a version.
// Actual's own client owns this database's schema/version (currently 9);
// passing a version from here risks a mismatched-version conflict
// (`onupgradeneeded`/`onblocked`) with Actual's own open connection, so we
// let the browser open it at whatever version it's already at.
function openDatabase() {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME);
    openRequest.onsuccess = (e) => resolve(e.target.result);
    openRequest.onupgradeneeded = (e) => resolve(e.target.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

// Reads Actual's session token out of IndexedDB. Resolves with `null`
// (never rejects) whenever the token isn't available for any reason -
// IndexedDB unsupported, the database or `asyncStorage` store missing, or
// the open/read failing outright - so a browser tab with no token yet
// still makes the request and lets the server 401 it, rather than
// crashing the widget.
async function readToken() {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  let db;
  try {
    db = await openDatabase();
  } catch {
    return null;
  }

  try {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      return null;
    }

    const token = await new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.get(TOKEN_KEY);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });

    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// Fetches `path`, attaching Actual's session token the same way Actual's
// own client authenticates its own API requests. Only attaches the
// header - it does not interpret the response, so callers still check
// `response.ok`, parse JSON, and handle non-200s themselves.
export async function fetchApi(path, options = {}) {
  const token = await readToken();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set(TOKEN_HEADER, token);
  }

  return fetch(path, { ...options, headers });
}
