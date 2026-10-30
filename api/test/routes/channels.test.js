jest.mock('../../src/auth');
jest.mock('../../src/channels/store');
jest.mock('../../src/notify');

const { validateToken } = require('../../src/auth');
const { readChannels, writeChannels } = require('../../src/channels/store');
const { notify } = require('../../src/notify');

const AUTH_HEADERS = { 'X-ACTUAL-TOKEN': 'valid-test-token' };
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

async function withServer(fn) {
  const app = require('../../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const NTFY_SECRET_TOPIC = 'demo-secret-topic-9f3';
const NTFY_TOKEN = 'tk_demo_secret_token';
const NTFY = {
  id: 'c-ntfy',
  name: 'Phone',
  type: 'ntfy',
  config: { server: 'https://ntfy.example.test', topic: NTFY_SECRET_TOPIC, token: NTFY_TOKEN, priority: '3' },
};
const WEBHOOK = {
  id: 'c-hook',
  name: 'Agent',
  type: 'webhook',
  config: { url: 'https://agent.example.test/in/abc123secret', method: 'POST', headers: [{ name: 'X-Auth', value: 'hdr-secret-value' }] },
};

let stored;
beforeEach(() => {
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  stored = [NTFY, WEBHOOK].map((c) => JSON.parse(JSON.stringify(c)));
  readChannels.mockReset();
  readChannels.mockImplementation(async () => stored);
  writeChannels.mockReset();
  writeChannels.mockImplementation(async (channels) => { stored = channels; });
  notify.mockReset();
});

const json = (res) => res.json();

test('GET lists redacted channels and the type metadata; no secret value appears anywhere', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of [NTFY_SECRET_TOPIC, NTFY_TOKEN, 'abc123secret', 'hdr-secret-value', 'agent.example.test']) {
      expect(text).not.toContain(secret);
    }
    const body = JSON.parse(text);
    const ntfy = body.channels.find((c) => c.id === 'c-ntfy');
    expect(ntfy.config).toEqual({ server: 'https://ntfy.example.test', priority: '3' });
    expect(ntfy.secretsSet.sort()).toEqual(['token', 'topic']);
    const hook = body.channels.find((c) => c.id === 'c-hook');
    expect(hook.config.headers).toEqual([{ name: 'X-Auth' }]);
    expect(hook.secretsSet.sort()).toEqual(['headers', 'url']);
    expect(body.types.map((t) => t.type)).toEqual(expect.arrayContaining(['ntfy', 'email', 'webhook', 'discord', 'slack', 'telegram', 'pushover', 'gotify', 'homeassistant', 'apprise']));
    expect(body.types.every((t) => !('send' in t))).toBe(true);
  });
});

test('every /api/channels route is behind auth', async () => {
  validateToken.mockResolvedValue(false);
  await withServer(async (base) => {
    expect((await fetch(`${base}/api/channels`, { headers: AUTH_HEADERS })).status).toBe(401);
    expect((await fetch(`${base}/api/channels`)).status).toBe(401);
    expect((await fetch(`${base}/api/channels/c-ntfy/test`, { method: 'POST', headers: AUTH_HEADERS })).status).toBe(401);
  });
});

test('POST creates a channel with a generated id, defaults applied, redacted response', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: '  Pager ', type: 'ntfy', config: { topic: 'new-topic', ignored: 'x' } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({ name: 'Pager', type: 'ntfy', config: { server: 'https://ntfy.sh', priority: '3' }, secretsSet: ['topic'] });
    expect(JSON.stringify(body)).not.toContain('new-topic');
    const saved = stored[stored.length - 1];
    expect(saved.config).toEqual({ server: 'https://ntfy.sh', topic: 'new-topic', priority: '3' });
  });
});

test.each([
  [{ name: 'x', type: 'nope', config: {} }, 'type'],
  [{ name: '  ', type: 'ntfy', config: { topic: 't' } }, 'name'],
  [{ name: 'x', type: 'ntfy', config: {} }, 'topic'],
  [{ name: 'x', type: 'ntfy', config: { topic: 't', server: 'not a url' } }, 'server'],
  [{ name: 'x', type: 'ntfy', config: { topic: 't', server: 'ftp://ntfy.example.test' } }, 'server'],
  [{ name: 'x', type: 'discord', config: { url: 'javascript:alert(1)' } }, 'url'],
  [{ name: 'x', type: 'ntfy', config: { topic: 't', priority: '9' } }, 'priority'],
  [{ name: 'x', type: 'email', config: { host: 'h.example.test', port: 'abc', security: 'tls', from: 'a@example.test', to: 'b@example.test' } }, 'port'],
  [{ name: 'x', type: 'email', config: { host: 'h.example.test', port: 25, security: 'tls', from: 'bad', to: 'b@example.test' } }, 'config'],
  [{ name: 'x', type: 'apprise', config: { apiUrl: 'http://a.example.test' } }, 'config'],
  [{ name: 'x', type: 'webhook', config: { url: 'https://h.example.test', headers: [{ name: '', value: 'v' }] } }, 'headers'],
])('POST %j is rejected with 400 naming the field %s', async (payload, field) => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe(field);
    expect(body.error).toBeTruthy();
  });
  expect(writeChannels).not.toHaveBeenCalled();
});

test('PUT with a secret omitted or null keeps the stored value', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels/c-ntfy`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Renamed', config: { server: 'https://ntfy2.example.test', token: null, priority: '5' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Renamed');
    expect(body.secretsSet.sort()).toEqual(['token', 'topic']);
    expect(JSON.stringify(body)).not.toContain(NTFY_TOKEN);
    expect(stored[0].config).toEqual({ server: 'https://ntfy2.example.test', topic: NTFY_SECRET_TOPIC, token: NTFY_TOKEN, priority: '5' });
  });
});

test('PUT with a new secret string replaces it, and an empty string clears an optional one', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/channels/c-ntfy`, {
      method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ config: { topic: 'brand-new-topic', token: '' } }),
    });
    expect(stored[0].config.topic).toBe('brand-new-topic');
    expect(stored[0].config).not.toHaveProperty('token');
    const list = await json(await fetch(`${base}/api/channels`, { headers: AUTH_HEADERS }));
    expect(list.channels[0].secretsSet).toEqual(['topic']);
  });
});

test('PUT keeps a stored header value when the entry arrives without one, and replaces it when given', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/channels/c-hook`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ config: { headers: [{ name: 'X-Auth' }, { name: 'X-New', value: 'fresh' }] } }),
    });
    expect(stored[1].config.headers).toEqual([{ name: 'X-Auth', value: 'hdr-secret-value' }, { name: 'X-New', value: 'fresh' }]);
    expect(stored[1].config.url).toBe('https://agent.example.test/in/abc123secret');
  });
});

test('PUT cannot change the type, rejects an invalid URL, and 404s for an unknown id', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/channels/c-ntfy`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ type: 'slack', config: {} }) });
    expect(stored[0].type).toBe('ntfy');

    const bad = await fetch(`${base}/api/channels/c-ntfy`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ config: { server: 'nope' } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe('server');

    const missing = await fetch(`${base}/api/channels/zzz`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name: 'x' }) });
    expect(missing.status).toBe(404);
  });
});

test('DELETE removes the channel (204) and 404s for an unknown id', async () => {
  await withServer(async (base) => {
    expect((await fetch(`${base}/api/channels/c-ntfy`, { method: 'DELETE', headers: AUTH_HEADERS })).status).toBe(204);
    expect(stored.map((c) => c.id)).toEqual(['c-hook']);
    expect((await fetch(`${base}/api/channels/zzz`, { method: 'DELETE', headers: AUTH_HEADERS })).status).toBe(404);
  });
});

test('POST /:id/test sends a test message through notify and returns its result', async () => {
  notify.mockResolvedValue({ ok: false, error: 'HTTP 500' });
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels/c-ntfy/test`, { method: 'POST', headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'HTTP 500' });
    const [id, message] = notify.mock.calls[0];
    expect(id).toBe('c-ntfy');
    expect(message).toMatchObject({ title: 'Actual Insights test', data: { test: true } });
    expect(message.text).toBeTruthy();
    expect(message.markdown).toBeTruthy();
    expect(message.html).toBeTruthy();

    expect((await fetch(`${base}/api/channels/zzz/test`, { method: 'POST', headers: AUTH_HEADERS })).status).toBe(404);
  });
});

test('a storage failure is a 500 that does not echo the error text', async () => {
  readChannels.mockRejectedValue(new Error('parse failed near https://secret.example.test/tok'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/channels`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret.example.test');
  });
  expect(spy.mock.calls.flat().join(' ')).not.toContain('secret.example.test');
  spy.mockRestore();
});
