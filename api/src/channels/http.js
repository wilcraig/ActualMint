// Shared HTTP plumbing for channel types. Lives apart from registry.js
// because the types import it and registry.js imports the types.

const DEFAULT_TIMEOUT_MS = 15000;

// Throws `HTTP <status>` plus up to 200 chars of the response body for any
// non-2xx response, so the failure reason reaches the user (notify scrubs
// secrets out of it).
async function ensureOk(res) {
  if (res.ok) return;
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    // Body unreadable; the status alone will do.
  }
  throw new Error(body ? `HTTP ${res.status}: ${body}` : `HTTP ${res.status}`);
}

// fetch with the 15s timeout and the ensureOk check applied.
async function request(deps, url, init = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const res = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  await ensureOk(res);
  return res;
}

function postJson(deps, url, body, { method = 'POST', headers = {} } = {}) {
  return request(deps, url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

// `base` with any trailing slashes dropped, so `${base}/path` is clean.
function trimSlash(base) {
  return String(base).replace(/\/+$/, '');
}

module.exports = { ensureOk, request, postJson, truncate, trimSlash, DEFAULT_TIMEOUT_MS };
