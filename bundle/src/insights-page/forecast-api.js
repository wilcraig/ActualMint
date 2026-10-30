import { fetchApi } from '../api-client';

// Thrown for any non-ok response. `field` is the settings path the API's
// 400 names (e.g. 'channelId'), when it names one.
export class ForecastApiError extends Error {
  constructor(message, field = null) {
    super(message);
    this.field = field;
  }
}

async function call(path, options) {
  let response;
  try {
    response = await fetchApi(path, options);
  } catch {
    throw new ForecastApiError('Could not reach insights-api.');
  }

  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body: fall back to the status below.
    }
    throw new ForecastApiError(body?.error || `Request failed (${response.status})`, body?.field ?? null);
  }
  return response.json();
}

function jsonBody(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// -> { settings, accounts: [{ id, name, balanceCents }], timezone }
export function getSettings() {
  return call('/api/forecast/settings');
}

// -> { settings } (normalized by the API)
export function saveSettings(settings) {
  return call('/api/forecast/settings', jsonBody('PUT', settings));
}

// Computes the forecast for the saved settings; sends nothing. -> { forecast }
export function checkNow() {
  return call('/api/forecast/check', jsonBody('POST', {}));
}

// -> { ok: true } | { ok: false, error }
export function sendTestMessage() {
  return call('/api/forecast/test', jsonBody('POST', {}));
}

// -> { history: [...] }
export function getHistory() {
  return call('/api/forecast/history');
}
