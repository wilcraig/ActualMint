import { fetchApi } from '../api-client';

// Thrown for any non-ok response. `field` names the offending form field
// when the API's 400 says which one it was.
export class ChannelsApiError extends Error {
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
    throw new ChannelsApiError('Could not reach insights-api.');
  }

  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body: fall back to the status below.
    }
    throw new ChannelsApiError(body?.error || `Request failed (${response.status})`, body?.field ?? null);
  }
  if (response.status === 204) return null;
  return response.json();
}

function jsonBody(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// -> { channels: [{ id, name, type, config, secretsSet }], types: [...] }
export function listChannels() {
  return call('/api/channels');
}

export function createChannel(body) {
  return call('/api/channels', jsonBody('POST', body));
}

export function updateChannel(id, body) {
  return call(`/api/channels/${encodeURIComponent(id)}`, jsonBody('PUT', body));
}

export function deleteChannel(id) {
  return call(`/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// -> { ok: true } | { ok: false, error }
export function testChannel(id) {
  return call(`/api/channels/${encodeURIComponent(id)}/test`, { method: 'POST' });
}
