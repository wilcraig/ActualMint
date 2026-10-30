import { fetchApi } from '../api-client';

// Thrown for any non-ok response. `field` is the settings path the API's
// 400 names (e.g. 'deliveries[0].schedule.times'), when it names one.
export class SummariesApiError extends Error {
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
    throw new SummariesApiError('Could not reach insights-api.');
  }

  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body: fall back to the status below.
    }
    throw new SummariesApiError(body?.error || `Request failed (${response.status})`, body?.field ?? null);
  }
  return response.json();
}

function jsonBody(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// -> { settings, sections: [{ id, title }], timezone }
export function getSettings() {
  return call('/api/summaries/settings');
}

// -> { settings } (normalized by the API)
export function saveSettings(settings) {
  return call('/api/summaries/settings', jsonBody('PUT', settings));
}

// body: { deliveryId } or { delivery, settings } -> { message: { title, text, markdown, html, data } }
export function previewSummary(body) {
  return call('/api/summaries/preview', jsonBody('POST', body));
}

// -> { ok: true } | { ok: false, error }
export function sendSummary(deliveryId) {
  return call('/api/summaries/send', jsonBody('POST', { deliveryId }));
}

// -> { history: [{ at, deliveryId, deliveryName, ok, error?, trigger }] }
export function getHistory() {
  return call('/api/summaries/history');
}

// -> { payees: [{ id, name }], schedules: [{ id, name }] }
export function getOptions() {
  return call('/api/summaries/options');
}

// -> { categories: [{ id, name, groupName }] }
export function getCategories() {
  return call('/api/categories');
}

// -> { channels: [{ id, name, type }], types }
export function getChannels() {
  return call('/api/channels');
}
